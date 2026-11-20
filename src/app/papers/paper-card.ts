import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { Paper } from '../data/paper.js';

@Component({
  selector: 'app-paper-card',
  standalone: true,
  templateUrl: './paper-card.html',
  styleUrl: './paper-card.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PaperCard {
  readonly paper = input.required<Paper>();
}
