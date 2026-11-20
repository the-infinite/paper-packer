import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { inject, Injectable, InjectionToken } from '@angular/core';
import { catchError, map, Observable, throwError, timeout, TimeoutError } from 'rxjs';
import { InvalidCoreResponseError, normalizeCoreResults, PaperResults } from './paper.js';

export const CORE_SEARCH_URL = 'https://api.core.ac.uk/v3/search/works/';
export const CORE_PAGE_SIZE = 10;
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

  search(query: string): Observable<PaperResults> {
    const trimmed = query.trim();
    if (!trimmed) return throwError(() => new CoreSearchError('query', 'Enter a topic to search for.', false));
    const params = new HttpParams()
      .set('q', trimmed)
      .set('limit', CORE_PAGE_SIZE)
      .set('exclude', 'fullText');

    return this.http.get<unknown>(CORE_SEARCH_URL, { params }).pipe(
      timeout({ first: this.timeoutMs }),
      map(normalizeCoreResults),
      catchError((error: unknown) => throwError(() => searchError(error))),
    );
  }
}
