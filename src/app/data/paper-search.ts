import { computed, DestroyRef, inject, Injectable, signal } from '@angular/core';
import { Subscription } from 'rxjs';
import { CoreApi, CoreSearchError, searchError } from './core-api.js';
import { PaperResults } from './paper.js';
import { DEFAULT_RESULT_LIMIT, SearchRequest, validateSearchInput } from './search-query.js';
import { aggregateCompletePaperSet, reconcileYearCoverage, YearAggregation, YearDistribution } from './year-distribution.js';

export type YearChartState =
  | { readonly status: 'idle' }
  | { readonly status: 'waiting' | 'loading'; readonly query: string }
  | { readonly status: 'ready' | 'incomplete'; readonly query: string; readonly distribution: YearDistribution }
  | { readonly status: 'error'; readonly query: string; readonly error: CoreSearchError };

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
  private readonly currentYearChart = signal<YearChartState>({ status: 'idle' });
  private readonly chartRetryReady = signal(true);
  private chartRequest?: Subscription;
  private chartQuery: string | null = null;
  private chartTotal: number | null = null;
  private chartData: YearAggregation | null = null;
  private chartBackoff: CoreSearchError | null = null;
  private chartRetryTimer?: ReturnType<typeof setTimeout>;

  readonly state = this.currentState.asReadonly();
  readonly yearChart = this.currentYearChart.asReadonly();
  readonly inputError = signal('');
  readonly limitError = signal('');
  readonly canSearch = computed(() => this.retryReady());
  readonly canRetry = computed(() => {
    const state = this.state();
    return state.status === 'error' && state.error.retryable && this.canSearch();
  });
  readonly canRetryYearChart = computed(() => {
    const chart = this.yearChart();
    return this.state().status === 'success' && this.chartRetryReady()
      && (chart.status === 'incomplete' || (chart.status === 'error' && chart.error.retryable));
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
      this.chartRequest?.unsubscribe();
      clearTimeout(this.chartRetryTimer);
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
    this.prepareYearChart(query);
    this.currentState.set({ status: 'loading', query, limit });
    this.request = this.api.search(query, limit).subscribe({
      next: (results) => {
        this.currentState.set({ status: 'success', query, limit, results });
        this.loadYearChart(query, results);
      },
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

  retryYearChart(): boolean {
    const state = this.state();
    if (!this.canRetryYearChart() || state.status !== 'success') return false;
    this.chartData = null;
    this.loadYearChart(state.query, state.results);
    return true;
  }

  private prepareYearChart(query: string): void {
    if (this.chartQuery === query) return;
    this.chartRequest?.unsubscribe();
    this.chartQuery = query;
    this.chartTotal = null;
    this.chartData = null;
    this.currentYearChart.set(this.chartBackoff && !this.chartRetryReady()
      ? { status: 'error', query, error: this.chartBackoff } : { status: 'waiting', query });
  }

  private loadYearChart(query: string, results: PaperResults): void {
    this.chartTotal = results.totalHits;
    const fullSet = aggregateCompletePaperSet(results);
    if (fullSet) {
      this.chartRequest?.unsubscribe();
      this.chartData = fullSet;
    }
    if (this.chartData) { this.updateYearCoverage(query); return; }
    if (this.chartRequest && !this.chartRequest.closed) return;
    if (!this.chartRetryReady() && this.chartBackoff) {
      this.currentYearChart.set({ status: 'error', query, error: this.chartBackoff });
      return;
    }
    this.currentYearChart.set({ status: 'loading', query });
    this.chartRequest = this.api.aggregateYears(query).subscribe({
      next: (data) => {
        if (this.chartQuery !== query) return;
        this.chartData = data;
        this.updateYearCoverage(query);
      },
      error: (cause: unknown) => {
        if (this.chartQuery !== query) return;
        const error = searchError(cause);
        this.currentYearChart.set({ status: 'error', query, error });
        if (error.retryAt !== null) {
          this.chartBackoff = error;
          this.pauseChartUntil(error.retryAt);
        }
      },
    });
  }

  private updateYearCoverage(query: string): void {
    if (!this.chartData) return;
    const distribution = reconcileYearCoverage(this.chartData, this.chartTotal);
    this.currentYearChart.set({
      status: distribution.complete ? 'ready' : 'incomplete', query, distribution,
    });
  }

  private pauseChartUntil(deadline: number): void {
    clearTimeout(this.chartRetryTimer);
    const remaining = deadline - Date.now();
    this.chartRetryReady.set(remaining <= 0);
    if (remaining > 0) {
      this.chartRetryTimer = setTimeout(() => this.pauseChartUntil(deadline), Math.min(remaining, 2_147_483_647));
    } else this.chartBackoff = null;
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
