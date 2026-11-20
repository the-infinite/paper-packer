import { computed, DestroyRef, inject, Injectable, signal } from '@angular/core';
import { Subscription } from 'rxjs';
import { CoreApi, CoreSearchError, searchError } from './core-api.js';
import { PaperResults } from './paper.js';
import { DEFAULT_RESULT_LIMIT, SearchRequest, validateSearchInput } from './search-query.js';

export type PaperSearchState =
  | { readonly status: 'idle' }
  | ({ readonly status: 'loading' } & SearchRequest)
  | ({ readonly status: 'success'; readonly results: PaperResults } & SearchRequest)
  | ({ readonly status: 'error'; readonly error: CoreSearchError } & SearchRequest);

@Injectable()
export class PaperSearch {
  private readonly api = inject(CoreApi);
  private readonly destroyRef = inject(DestroyRef);
  private readonly currentState = signal<PaperSearchState>({ status: 'idle' });
  private readonly retryReady = signal(true);
  private request?: Subscription;
  private retryTimer?: ReturnType<typeof setTimeout>;

  readonly state = this.currentState.asReadonly();
  readonly inputError = signal('');
  readonly limitError = signal('');
  readonly canSearch = computed(() => this.retryReady());
  readonly canRetry = computed(() => {
    const state = this.state();
    return state.status === 'error' && state.error.retryable && this.canSearch();
  });
  readonly announcement = computed(() => {
    const state = this.state();
    switch (state.status) {
      case 'idle': return 'Enter a topic to start exploring.';
      case 'loading': return `Searching CORE for “${state.query}”.`;
      case 'error': return 'The search could not be completed.';
      case 'success': {
        const count = state.results.papers.length;
        return count === 0 ? `No papers returned for “${state.query}”.`
          : `${count} ${count === 1 ? 'paper' : 'papers'} loaded for “${state.query}”.`;
      }
    }
  });

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.request?.unsubscribe();
      clearTimeout(this.retryTimer);
    });
  }

  submit(rawQuery: string, rawLimit: unknown = DEFAULT_RESULT_LIMIT): boolean {
    if (!this.canSearch()) return false;
    const checked = validateSearchInput(rawQuery, rawLimit);
    this.inputError.set(checked.queryError);
    this.limitError.set(checked.limitError);
    if (!checked.request) return false;
    const { query, limit } = checked.request;
    const active = this.state();
    if (active.status === 'loading' && active.query === query && active.limit === limit) return false;
    this.request?.unsubscribe();
    this.currentState.set({ status: 'loading', query, limit });
    this.request = this.api.search(query, limit).subscribe({
      next: (results) => this.currentState.set({ status: 'success', query, limit, results }),
      error: (cause: unknown) => {
        const error = searchError(cause);
        this.currentState.set({ status: 'error', query, limit, error });
        if (error.retryAt !== null) this.pauseUntil(error.retryAt);
      },
    });
    return true;
  }

  retry(): boolean {
    const state = this.state();
    return state.status === 'error' && this.canRetry() ? this.submit(state.query, state.limit) : false;
  }

  private pauseUntil(deadline: number): void {
    clearTimeout(this.retryTimer);
    const remaining = deadline - Date.now();
    this.retryReady.set(remaining <= 0);
    if (remaining > 0) {
      this.retryTimer = setTimeout(() => this.pauseUntil(deadline), Math.min(remaining, 2_147_483_647));
    }
  }
}
