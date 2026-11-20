import { DatePipe, DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { YearChartState } from '../data/paper-search.js';
import { yearChartRows } from '../data/year-distribution.js';

@Component({
  selector: 'app-publication-chart',
  standalone: true,
  imports: [DatePipe, DecimalPipe],
  templateUrl: './publication-chart.html',
  styleUrl: './publication-chart.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PublicationChart {
  readonly state = input.required<YearChartState>();
  readonly canRetry = input(false);
  readonly retryRequested = output<void>();
  readonly rows = computed(() => {
    const state = this.state();
    return state.status === 'ready' || state.status === 'incomplete'
      ? yearChartRows(state.distribution) : [];
  });
}
