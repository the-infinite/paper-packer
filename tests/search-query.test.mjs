import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BOOLEAN_EXAMPLE, DEFAULT_RESULT_LIMIT, MAX_QUERY_LENGTH, MAX_RESULT_LIMIT,
  validateQuery, validateSearchInput,
} from '../.angular/tests/app/data/search-query.js';

test('accepts grouped Boolean queries without rewriting grouping, casing, or phrases', () => {
  for (const query of [BOOLEAN_EXAMPLE, 'drone AND (package OR delivery)',
    'NOT drone', 'drone NOT military', 'drone AND NOT military',
    '((drone OR helicopter) AND delivery)', '"AND" OR "package (delivery)"',
    String.raw`"a \"quoted\" phrase" AND drone`, String.raw`drone\(delivery\)`,
    'climate change', 'war and peace', 'title:"drone delivery" AND yearPublished:2024']) {
    assert.equal(validateQuery(query), '', query);
    assert.equal(validateSearchInput(`  ${query}  `, 25).request.query, query);
  }
});

test('rejects unbalanced groups and unfinished operators before any request', () => {
  for (const query of ['(drone', 'drone)', '()', 'drone AND ()', 'AND drone', 'OR drone',
    'drone AND', 'drone OR', 'NOT', 'drone AND OR delivery', 'drone OR AND delivery',
    '(drone OR)', 'drone AND NOT', '(drone) AND (delivery OR)']) {
    assert.ok(validateQuery(query), query);
    assert.equal(validateSearchInput(query, 10).request, null);
  }
});

test('does not confuse parentheses or operators inside quoted/escaped terms with syntax', () => {
  assert.equal(validateQuery('"drone (AND OR" AND delivery'), '');
  assert.equal(validateQuery(String.raw`drone\) AND delivery`), '');
  assert.equal(validateQuery('"drone" AND "delivery'), 'Close the quotation marks around your phrase.');
  assert.ok(validateQuery('drone AND ""'));
  assert.ok(validateQuery('drone\\'));
});

test('enforces meaningful, single-line queries of at most 500 characters', () => {
  for (const query of ['', '   ', 'drone\ndelivery', 'drone\u0000', 'a'.repeat(MAX_QUERY_LENGTH + 1)]) {
    assert.ok(validateQuery(query));
  }
  assert.equal(validateQuery('a'.repeat(MAX_QUERY_LENGTH)), '');
});

test('accepts integer return counts throughout the supported range, with a ten-paper default', () => {
  assert.equal(validateSearchInput('drone').request.limit, DEFAULT_RESULT_LIMIT);
  for (const limit of [1, 2, 25, 50, MAX_RESULT_LIMIT, '1', '100', ' 25 ']) {
    const checked = validateSearchInput('drone', limit);
    assert.equal(checked.limitError, '');
    assert.equal(checked.request.limit, Number(limit));
  }
});

test('rejects missing, fractional, non-numeric, and out-of-range counts without clamping', () => {
  for (const limit of [0, -1, MAX_RESULT_LIMIT + 1, 1.5, NaN, Infinity,
    '', ' ', '2.5', '1e2', '10 papers', null, {}, true]) {
    const checked = validateSearchInput('drone', limit);
    assert.equal(checked.request, null, String(limit));
    assert.ok(checked.limitError, String(limit));
  }
});

test('reports query and count errors together instead of discarding either input', () => {
  const checked = validateSearchInput('(drone AND', 0);
  assert.ok(checked.queryError);
  assert.ok(checked.limitError);
  assert.equal(checked.request, null);
});
