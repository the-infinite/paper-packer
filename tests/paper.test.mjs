import assert from 'node:assert/strict';
import { test } from 'node:test';
import { InvalidCoreResponseError, normalizeCoreResults, safeExternalUrl } from '../.angular/tests/app/data/paper.js';

test('normalizes CORE works and keeps the matching total distinct from the loaded count', () => {
  const result = normalizeCoreResults({ totalHits: 132, results: [{
    id: 42, title: '  Drone delivery research  ', authors: [{ name: 'A. Researcher' }],
    abstract: 'A synthetic contract fixture.', yearPublished: '2024',
    downloadUrl: 'https://example.org/paper.pdf',
  }] });
  assert.equal(result.totalHits, 132);
  assert.equal(result.papers.length, 1);
  assert.deepEqual(result.papers[0], {
    id: '42', title: 'Drone delivery research', authors: ['A. Researcher'],
    abstract: 'A synthetic contract fixture.', year: 2024,
    recordUrl: 'https://core.ac.uk/works/42', fullTextUrl: 'https://example.org/paper.pdf',
  });
});

test('handles missing metadata without inventing titles, dates, authors, or links', () => {
  const { papers, totalHits } = normalizeCoreResults({ results: [{}] });
  assert.equal(totalHits, null);
  assert.deepEqual(papers[0], {
    id: null, title: 'Untitled paper', authors: [], abstract: null,
    year: null, recordUrl: null, fullTextUrl: null,
  });
});

test('deduplicates author names and uses the first valid full-text source', () => {
  const { papers } = normalizeCoreResults({ results: [{
    id: '125', authors: [{ name: 'Alice' }, null, { name: 'Alice' }, 'Bob', {}, 3],
    downloadUrl: 'javascript:alert(1)', sourceFulltextUrls: ['invalid', 'https://example.org/source'],
    yearPublished: 'not-a-year',
  }] });
  assert.deepEqual(papers[0].authors, ['Alice', 'Bob']);
  assert.equal(papers[0].fullTextUrl, 'https://example.org/source');
  assert.equal(papers[0].year, null);
});

test('rejects invalid response shapes rather than reporting a false empty result', () => {
  for (const input of [null, [], {}, { results: null }, { results: [null] }, { results: ['paper'] }]) {
    assert.throws(() => normalizeCoreResults(input), InvalidCoreResponseError);
  }
  assert.deepEqual(normalizeCoreResults({ totalHits: 0, results: [] }), { totalHits: 0, papers: [] });
});

test('does not report invalid totals as an accurate matching count', () => {
  for (const total of [-1, '100', Infinity, NaN, 0]) {
    assert.equal(normalizeCoreResults({ totalHits: total, results: [{}] }).totalHits, null);
  }
});

test('only permits absolute HTTP(S) links without embedded credentials', () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,hi', '//example.org', '/relative',
    'file:///tmp/paper', 'https://user:secret@example.org', 'https://', null, 2]) {
    assert.equal(safeExternalUrl(url), null, String(url));
  }
  assert.equal(safeExternalUrl(' https://example.org/paper '), 'https://example.org/paper');
});

test('does not construct record links from unsafe or imprecise identifiers', () => {
  for (const id of ['../bad', 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(normalizeCoreResults({ results: [{ id }] }).papers[0].recordUrl, null);
  }
});

test('uses a valid publication date when a separate year is missing, without inventing dates', () => {
  const result = normalizeCoreResults({ results: [
    { publishedDate: '2023-04-15T00:00:00+00:00' },
    { yearPublished: 2022, publishedDate: '2023-04-15' },
    { publishedDate: '2023-02-31' },
    { publishedDate: 'unknown' },
  ] });
  assert.deepEqual(result.papers.map((paper) => paper.year), [2023, 2022, null, null]);
});
