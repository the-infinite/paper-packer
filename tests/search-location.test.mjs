import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readSearchLocation, writeSearchLocation } from '../.angular/tests/app/data/search-location.js';
import { validateSearchInput } from '../.angular/tests/app/data/search-query.js';

test('round-trips grouped expressions, phrases, plus signs, ampersands, and Unicode', () => {
  for (const query of ['(drone AND (package OR delivery))', '"health & safety" OR C++',
    'title:"énergie renouvelable"', 'drone NOT "(military)"']) {
    const href = writeSearchLocation('https://example.org/research#workspace', { query, limit: 25 });
    assert.deepEqual(readSearchLocation(href), { query, limit: '25', hasQuery: true });
    assert.equal(new URL(href).hash, '#workspace');
  }
});

test('preserves the route, other URL parameters, and fragment when updating a search', () => {
  const url = new URL(writeSearchLocation('https://example.org/papers?source=shared&q=old&limit=10#workspace', {
    query: 'drone', limit: 50,
  }));
  assert.equal(url.pathname, '/papers');
  assert.equal(url.searchParams.get('source'), 'shared');
  assert.equal(url.searchParams.getAll('q').length, 1);
  assert.equal(url.searchParams.get('q'), 'drone');
  assert.equal(url.searchParams.get('limit'), '50');
  assert.equal(url.hash, '#workspace');
});

test('uses defaults for a fresh visit and preserves invalid URL input for validation', () => {
  assert.deepEqual(readSearchLocation('https://example.org/'), { query: '', limit: '10', hasQuery: false });
  for (const href of ['https://example.org/?q=(drone&limit=25',
    'https://example.org/?q=drone&limit=0', 'https://example.org/?q=drone&limit=101',
    'https://example.org/?q=&limit=10', 'https://example.org/?q=drone&limit=2.5']) {
    const initial = readSearchLocation(href);
    assert.equal(initial.hasQuery, true);
    assert.equal(validateSearchInput(initial.query, initial.limit).request, null);
  }
});
