import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  aggregateCompletePaperSet, InvalidYearAggregationError, normalizeYearAggregation, reconcileYearCoverage, yearChartRows,
} from '../.angular/tests/app/data/year-distribution.js';

const response = (years, extra = {}) => ({ aggregations: { yearPublished: years }, ...extra });

test('normalizes the CORE year dictionary and proves complete coverage against the query total', () => {
  const raw = normalizeYearAggregation(response({ '2020': 12, '"2024"': 8, '': 2, '0': 1 }));
  assert.deepEqual(raw.years, [{ year: 2024, count: 8 }, { year: 2020, count: 12 }]);
  const result = reconcileYearCoverage(raw, 23);
  assert.equal(result.datedCount, 20);
  assert.equal(result.missingYear, 3);
  assert.equal(result.accountedCount, 23);
  assert.equal(result.complete, true);
  assert.equal(result.issue, null);
});

test('never relabels omitted or truncated buckets as missing publication years', () => {
  const result = reconcileYearCoverage(normalizeYearAggregation(response({ '2024': 10 })), 25);
  assert.equal(result.complete, false);
  assert.equal(result.issue, 'under-count');
  assert.equal(result.missingYear, 0);
  assert.equal(result.unaccountedCount, 15);
});

test('represents an explicit unknown-year bucket and a verified empty query', () => {
  const unknown = reconcileYearCoverage(normalizeYearAggregation(response({ null: 10 })), 10);
  assert.equal(unknown.complete, true);
  assert.equal(unknown.missingYear, 10);
  assert.deepEqual(unknown.years, []);
  const empty = reconcileYearCoverage(normalizeYearAggregation(response({})), 0);
  assert.equal(empty.complete, true);
  assert.equal(empty.accountedCount, 0);
});

test('does not declare full coverage without a matching total or with excess counts', () => {
  const raw = normalizeYearAggregation(response({ '2024': 10 }));
  assert.equal(reconcileYearCoverage(raw, null).issue, 'unknown-total');
  const excess = reconcileYearCoverage(raw, 5);
  assert.equal(excess.complete, false);
  assert.equal(excess.issue, 'over-count');
  assert.equal(excess.missingYear, 0);
});

test('checks an aggregation-reported total and notices totals changing between requests', () => {
  const raw = normalizeYearAggregation(response({ '2024': 10 }, { totalHits: 10 }));
  assert.equal(reconcileYearCoverage(raw, null).complete, true);
  assert.equal(reconcileYearCoverage(raw, 12).issue, 'changed-total');
  assert.equal(reconcileYearCoverage(raw, 10).complete, true);
});

test('rejects malformed shapes, unexplained keys, and invalid counts instead of charting them', () => {
  for (const input of [null, [], {}, { aggregations: null },
    { aggregations: { yearPublished: [] } }, response({ invalid: 2 }),
    response({ '2024': '10' }), response({ '2024': -1 }),
    response({ '2024': 1.5 }), response({ '2024': Infinity }),
    response({ '2024': 10 }, { totalHits: -1 }),
    response({ sum_other_doc_count: 12 })]) {
    assert.throws(() => normalizeYearAggregation(input), InvalidYearAggregationError);
  }
});

test('rejects duplicate canonical years and counts that overflow safe integer precision', () => {
  assert.throws(() => normalizeYearAggregation(response({ '2024': 10, '"2024"': 10 })), InvalidYearAggregationError);
  assert.throws(() => normalizeYearAggregation(response({ '2024': Number.MAX_SAFE_INTEGER, '2023': 1 })), InvalidYearAggregationError);
});

test('ignores zero-height years and keeps latest years first', () => {
  const raw = normalizeYearAggregation(response({ '2020': 2, '2023': 0, '2024': 4 }));
  assert.deepEqual(raw.years, [{ year: 2024, count: 4 }, { year: 2020, count: 2 }]);
});

test('chart rows use the same exact counts as the data table and scale against the largest bucket', () => {
  const data = reconcileYearCoverage(normalizeYearAggregation(response({ '2024': 40, '2020': 20, null: 10 })), 70);
  assert.deepEqual(yearChartRows(data), [
    { label: '2024', count: 40, width: 100, missing: false },
    { label: '2020', count: 20, width: 50, missing: false },
    { label: 'Missing/invalid year', count: 10, width: 25, missing: true },
  ]);
});

test('empty and all-unknown distributions never produce invalid bar widths', () => {
  const empty = reconcileYearCoverage(normalizeYearAggregation(response({})), 0);
  assert.deepEqual(yearChartRows(empty), []);
  const unknown = reconcileYearCoverage(normalizeYearAggregation(response({ null: 10 })), 10);
  assert.equal(yearChartRows(unknown)[0].width, 100);
});

test('aggregates client-side only when unique returned papers cover the entire query', () => {
  const raw = aggregateCompletePaperSet({ totalHits: 3, papers: [
    { id: '1', year: 2024 }, { id: '2', year: 2024 }, { id: '3', year: null },
  ] });
  assert.deepEqual(raw, { years: [{ year: 2024, count: 2 }], missingYear: 1, totalHits: 3 });
  assert.equal(reconcileYearCoverage(raw, 3).complete, true);
});

test('never treats a first page, unknown total, duplicate IDs, or missing IDs as complete data', () => {
  for (const result of [
    { totalHits: 100, papers: [{ id: '1', year: 2024 }] },
    { totalHits: null, papers: [{ id: '1', year: 2024 }] },
    { totalHits: 2, papers: [{ id: '1' }, { id: '1' }] },
    { totalHits: 1, papers: [{ id: null }] },
    { totalHits: 1, papers: [{}] },
  ]) assert.equal(aggregateCompletePaperSet(result), null);
});

test('complete empty and missing-year paper sets retain exact coverage', () => {
  assert.deepEqual(aggregateCompletePaperSet({ totalHits: 0, papers: [] }), { years: [], missingYear: 0, totalHits: 0 });
  assert.equal(aggregateCompletePaperSet({ totalHits: 1, papers: [{ id: '1', year: null }] }).missingYear, 1);
});
