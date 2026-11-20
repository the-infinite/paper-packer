import type { PaperResults } from './paper.js';

export interface YearBucket {
  readonly year: number;
  readonly count: number;
}

export interface YearAggregation {
  readonly years: readonly YearBucket[];
  readonly missingYear: number;
  readonly totalHits: number | null;
}

export interface YearDistribution extends YearAggregation {
  readonly datedCount: number;
  readonly accountedCount: number;
  readonly expectedTotal: number | null;
  readonly unaccountedCount: number | null;
  readonly complete: boolean;
  readonly issue: 'unknown-total' | 'under-count' | 'over-count' | 'changed-total' | null;
}

export interface YearChartRow {
  readonly label: string;
  readonly count: number;
  readonly width: number;
  readonly kind: 'year' | 'missing' | 'unaccounted';
}

export function yearChartRows(distribution: YearDistribution): readonly YearChartRow[] {
  const rows: Omit<YearChartRow, 'width'>[] = distribution.years.map((bucket) => ({
    label: String(bucket.year), count: bucket.count, kind: 'year',
  }));
  if (distribution.missingYear > 0) rows.push({ label: 'Missing/invalid year', count: distribution.missingYear, kind: 'missing' });
  if (distribution.issue === 'under-count' && distribution.unaccountedCount !== null && distribution.unaccountedCount > 0) {
    rows.push({ label: 'Not covered by year buckets', count: distribution.unaccountedCount, kind: 'unaccounted' });
  }
  const largest = rows.reduce((max, row) => Math.max(max, row.count), 0);
  return rows.map((row) => ({ ...row, width: largest ? (row.count / largest) * 100 : 0 }));
}

export function aggregateCompletePaperSet(results: PaperResults): YearAggregation | null {
  const ids = results.papers.map((paper) => paper.id);
  if (results.totalHits === null || results.papers.length !== results.totalHits
    || ids.some((id) => typeof id !== 'string' || !/^[1-9]\d*$/.test(id))
    || new Set(ids).size !== ids.length) return null;
  const years = new Map<number, number>();
  let missingYear = 0;
  for (const paper of results.papers) {
    if (typeof paper.year === 'number' && Number.isInteger(paper.year) && paper.year >= 1000 && paper.year <= 9999) {
      years.set(paper.year, (years.get(paper.year) ?? 0) + 1);
    } else missingYear++;
  }
  return {
    years: [...years].map(([year, amount]) => ({ year, count: amount })).sort((a, b) => b.year - a.year),
    missingYear, totalHits: results.totalHits,
  };
}

export class InvalidYearAggregationError extends Error {
  constructor() {
    super('CORE returned an unexpected publication-year aggregation.');
    this.name = 'InvalidYearAggregationError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function count(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new InvalidYearAggregationError();
  }
  return value;
}

export function normalizeYearAggregation(value: unknown): YearAggregation {
  if (!isRecord(value) || !isRecord(value['aggregations'])
    || !isRecord(value['aggregations']['yearPublished'])) throw new InvalidYearAggregationError();
  const years = new Map<number, number>();
  let missingYear = 0;
  let sum = 0;
  for (const [rawYear, rawCount] of Object.entries(value['aggregations']['yearPublished'])) {
    const amount = count(rawCount);
    const key = rawYear.trim().replace(/^(['"])(.*)\1$/, '$2').trim();
    sum = count(sum + amount);
    if (/^\d{4}$/.test(key) && Number(key) >= 1000 && Number(key) <= 9999) {
      const year = Number(key);
      if (years.has(year)) throw new InvalidYearAggregationError();
      years.set(year, amount);
    } else if (/^-?\d+$/.test(key) || ['', 'null', 'unknown', 'missing', 'none'].includes(key.toLowerCase())) {
      missingYear = count(missingYear + amount);
    } else {
      // An unexplained metadata key must not silently become a year bucket.
      throw new InvalidYearAggregationError();
    }
  }
  return {
    years: [...years].filter(([, amount]) => amount > 0)
      .map(([year, amount]) => ({ year, count: amount })).sort((a, b) => b.year - a.year),
    missingYear,
    totalHits: value['totalHits'] == null ? null : count(value['totalHits']),
  };
}

export function reconcileYearCoverage(aggregation: YearAggregation, queryTotal: number | null): YearDistribution {
  if (queryTotal !== null) count(queryTotal);
  const datedCount = count(aggregation.years.reduce((sum, bucket) => sum + bucket.count, 0));
  const accountedCount = count(datedCount + aggregation.missingYear);
  const expectedTotal = aggregation.totalHits ?? queryTotal;
  let issue: YearDistribution['issue'] = null;
  if (expectedTotal === null) issue = 'unknown-total';
  else if (aggregation.totalHits !== null && queryTotal !== null && aggregation.totalHits !== queryTotal) issue = 'changed-total';
  else if (accountedCount < expectedTotal) issue = 'under-count';
  else if (accountedCount > expectedTotal) issue = 'over-count';
  return {
    ...aggregation, datedCount, accountedCount, expectedTotal,
    unaccountedCount: expectedTotal === null ? null : Math.max(0, expectedTotal - accountedCount),
    complete: issue === null, issue,
  };
}
