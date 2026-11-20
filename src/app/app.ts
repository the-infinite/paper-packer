import { DatePipe, DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { CORE_PAGE_SIZE } from './data/core-api.js';
import { PaperSearch } from './data/paper-search.js';
import { PaperCard } from './papers/paper-card.js';

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
  readonly search = inject(PaperSearch);
  readonly resultLimit = CORE_PAGE_SIZE;

  submit(event: Event, query: string): void {
    event.preventDefault();
    this.search.submit(query);
  }
}
