import { computed, DestroyRef, inject, Injectable, signal } from '@angular/core';
import { Subscription } from 'rxjs';
import { CoreApi, CoreSearchError, searchError } from './core-api.js';
import { PaperResults } from './paper.js';

export type PaperSearchState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading'; readonly query: string }
  | { readonly status: 'success'; readonly query: string; readonly results: PaperResults }
  | { readonly status: 'error'; readonly query: string; readonly error: CoreSearchError };

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
  readonly canSearch = computed(() => this.state().status !== 'loading' && this.retryReady());
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

  submit(rawQuery: string): void {
    if (!this.canSearch()) return;
    const query = rawQuery.trim();
    if (!query) {
      this.inputError.set('Enter a topic to search for.');
      return;
    }
    this.inputError.set('');
    this.request?.unsubscribe();
    this.currentState.set({ status: 'loading', query });
    this.request = this.api.search(query).subscribe({
      next: (results) => this.currentState.set({ status: 'success', query, results }),
      error: (cause: unknown) => {
        const error = searchError(cause);
        this.currentState.set({ status: 'error', query, error });
        if (error.retryAt !== null && error.retryAt > Date.now()) {
          this.retryReady.set(false);
          this.retryTimer = setTimeout(() => this.retryReady.set(true),
            Math.min(error.retryAt - Date.now(), 2_147_483_647));
        }
      },
    });
  }

  retry(): void {
    const state = this.state();
    if (state.status === 'error' && this.canRetry()) this.submit(state.query);
  }
}
