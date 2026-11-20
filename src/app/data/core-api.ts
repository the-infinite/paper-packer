import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { inject, Injectable, InjectionToken } from '@angular/core';
import { catchError, map, Observable, switchMap, throwError, timeout, TimeoutError } from 'rxjs';
import { InvalidCoreResponseError } from './core-response-error.js';
import type { PaperResults } from './paper.js';
import { DEFAULT_RESULT_LIMIT, validateSearchInput } from './search-query.js';
import { InvalidYearAggregationError, normalizeYearAggregation, YearAggregation } from './year-distribution.js';

export const CORE_SEARCH_URL = 'https://api.core.ac.uk/v3/search/works/';
export const CORE_AGGREGATION_URL = 'https://api.core.ac.uk/v3/search/works/aggregate';
export const CORE_PAGE_SIZE = DEFAULT_RESULT_LIMIT;
export const CORE_TIMEOUT_MS = new InjectionToken<number>('CORE request timeout', {
  providedIn: 'root', factory: () => 30_000,
});

export type SearchErrorKind = 'network' | 'timeout' | 'rate-limit' | 'access' | 'query' | 'response' | 'service';

export class CoreSearchError extends Error {
  constructor(
    readonly kind: SearchErrorKind,
    message: string,
    readonly retryable = true,
    readonly retryAt: number | null = null,
  ) {
    super(message);
    this.name = 'CoreSearchError';
  }
}

function retryDeadline(error: HttpErrorResponse): number {
  const retry = error.headers.get('Retry-After') ?? error.headers.get('X-RateLimit-Retry-After');
  if (retry && /^\d+$/.test(retry.trim())) {
    const seconds = Number(retry);
    if (Number.isSafeInteger(seconds) && seconds >= 0 && seconds <= 86_400) return Date.now() + seconds * 1000;
  }
  if (retry) {
    const date = Date.parse(retry);
    if (Number.isFinite(date) && date > Date.now()) return date;
  }
  return Date.now() + 60_000;
}

export function searchError(error: unknown): CoreSearchError {
  if (error instanceof CoreSearchError) return error;
  if (error instanceof TimeoutError) {
    return new CoreSearchError('timeout', 'CORE took too long to respond. Please try again.');
  }
  if (error instanceof InvalidCoreResponseError) {
    return new CoreSearchError('response', 'CORE returned an unexpected response. Please try again.');
  }
  if (error instanceof HttpErrorResponse) {
    if (error.status === 0) return new CoreSearchError('network', 'We could not reach CORE. Check your connection and try again.');
    if (error.status === 429) {
      return new CoreSearchError('rate-limit', 'CORE has reached its request limit. Please wait before searching again.', true, retryDeadline(error));
    }
    if (error.status === 401 || error.status === 403) {
      return new CoreSearchError('access', 'CORE is not allowing this request right now. Please try again later.', false);
    }
    if (error.status === 400 || error.status === 422) {
      return new CoreSearchError('query', 'CORE could not interpret that search. Try different keywords.', false);
    }
  }
  return new CoreSearchError('service', 'CORE is unavailable right now. Please try again shortly.');
}

@Injectable({ providedIn: 'root' })
export class CoreApi {
  private readonly http = inject(HttpClient);
  private readonly timeoutMs = inject(CORE_TIMEOUT_MS);

  search(query: string, limit = DEFAULT_RESULT_LIMIT): Observable<PaperResults> {
    const checked = validateSearchInput(query, limit);
    if (!checked.request) {
      return throwError(() => new CoreSearchError('query', checked.queryError || checked.limitError, false));
    }
    const params = new HttpParams()
      .set('q', checked.request.query)
      .set('limit', checked.request.limit)
      .set('exclude', 'fullText');

    return this.http.get<unknown>(CORE_SEARCH_URL, { params }).pipe(
      switchMap((value) => import('./paper.js').then(({ normalizeCoreResults }) => normalizeCoreResults(value))),
      timeout({ first: this.timeoutMs }),
      catchError((error: unknown) => throwError(() => searchError(error))),
    );
  }

  aggregateYears(query: string): Observable<YearAggregation> {
    const checked = validateSearchInput(query);
    if (!checked.request) {
      return throwError(() => new CoreSearchError('query', checked.queryError, false));
    }
    return this.http.post<unknown>(CORE_AGGREGATION_URL, {
      q: checked.request.query,
      aggregations: ['yearPublished'],
    }).pipe(
      timeout({ first: this.timeoutMs }),
      map(normalizeYearAggregation),
      catchError((error: unknown) => throwError(() => error instanceof InvalidYearAggregationError
        ? new CoreSearchError('response', 'CORE returned unexpected year data. Please try again.')
        : searchError(error))),
    );
  }
}
