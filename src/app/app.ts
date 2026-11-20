import { DatePipe, DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, DOCUMENT, inject, signal } from '@angular/core';
import { PaperSearch } from './data/paper-search.js';
import { PaperCard } from './papers/paper-card.js';
import {
  BOOLEAN_EXAMPLE, DEFAULT_RESULT_LIMIT, MAX_QUERY_LENGTH, MAX_RESULT_LIMIT,
  MIN_RESULT_LIMIT, validateSearchInput,
} from './data/search-query.js';
import { readSearchLocation, writeSearchLocation } from './data/search-location.js';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [DatePipe, DecimalPipe, PaperCard],
  providers: [PaperSearch],
  templateUrl: './app.html',
  styleUrl: './app.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  private readonly browser = inject(DOCUMENT).defaultView;
  readonly search = inject(PaperSearch);
  readonly query = signal('');
  readonly resultLimit = signal(String(DEFAULT_RESULT_LIMIT));
  readonly copyMessage = signal('');
  readonly minLimit = MIN_RESULT_LIMIT;
  readonly maxLimit = MAX_RESULT_LIMIT;
  readonly maxQueryLength = MAX_QUERY_LENGTH;
  readonly exampleQuery = BOOLEAN_EXAMPLE;
  readonly searchingCurrentInput = computed(() => {
    const state = this.search.state();
    const draft = validateSearchInput(this.query(), this.resultLimit()).request;
    return state.status === 'loading' && draft !== null
      && state.query === draft.query && state.limit === draft.limit;
  });
  readonly canSubmit = computed(() => this.search.canSearch() && !this.searchingCurrentInput());

  constructor() {
    if (this.browser) {
      const initial = readSearchLocation(this.browser.location.href);
      this.query.set(initial.query);
      this.resultLimit.set(initial.limit);
      if (initial.hasQuery) this.search.submit(initial.query, initial.limit);
    }
  }

  submit(event: Event): void {
    event.preventDefault();
    this.copyMessage.set('');
    if (this.search.submit(this.query(), this.resultLimit())) this.updateLocation();
  }

  retry(): void {
    const state = this.search.state();
    if (state.status !== 'error' || !this.search.canRetry()) return;
    this.query.set(state.query);
    this.resultLimit.set(String(state.limit));
    this.copyMessage.set('');
    if (this.search.retry()) this.updateLocation();
  }

  useExample(input: HTMLInputElement): void {
    this.query.set(BOOLEAN_EXAMPLE);
    this.search.inputError.set('');
    this.copyMessage.set('');
    input.focus();
  }

  async copyLink(): Promise<void> {
    const state = this.search.state();
    if (!this.browser || state.status === 'idle') return;
    const href = writeSearchLocation(this.browser.location.href, state);
    const isCurrent = () => {
      const current = this.search.state();
      return current.status !== 'idle' && current.query === state.query && current.limit === state.limit;
    };
    try {
      await this.browser.navigator.clipboard.writeText(href);
      if (isCurrent()) this.copyMessage.set('Search link copied.');
    } catch {
      if (isCurrent()) this.copyMessage.set('Copy the search link from the address bar.');
    }
  }

  private updateLocation(): void {
    const state = this.search.state();
    if (this.browser && state.status !== 'idle') {
      const href = writeSearchLocation(this.browser.location.href, state);
      this.browser.history.replaceState(this.browser.history.state, '', href);
    }
  }
}
