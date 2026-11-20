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

test('cleans the encoded paragraph markup observed in the live CORE response', () => {
  const { papers } = normalizeCoreResults({ results: [{
    abstract: '&lt;p&gt;First release of the research project.&lt;/p&gt',
  }] });
  assert.equal(papers[0].abstract, 'First release of the research project.');
});

test('preserves paragraph separation, entities, and scientific comparison symbols', () => {
  const { papers } = normalizeCoreResults({ results: [{
    abstract: '<p>A &amp; B: p &lt; 0.05.</p><p>A &lt; B &gt; C. CO<sub>2</sub>.</p>',
  }] });
  assert.equal(papers[0].abstract, 'A & B: p < 0.05.\n\nA < B > C. CO2.');
});

test('discards script/style/template content and markup without rendering provider HTML', () => {
  const { papers } = normalizeCoreResults({ results: [{
    abstract: '<script>alert(1)</script><style>body{display:none}</style><template>Hidden</template><p>Safe <img src="https://example.org/tracker" onerror="alert(1)">research.</p>',
  }] });
  assert.equal(papers[0].abstract, 'Safe research.');
});

test('handles nested entity encoding and abstracts without readable content', () => {
  const { papers } = normalizeCoreResults({ results: [
    { abstract: '&amp;lt;p&amp;gt;Research summary.&amp;lt;/p&amp;gt;' },
    { abstract: '<p> &nbsp; </p>' },
  ] });
  assert.deepEqual(papers.map((paper) => paper.abstract), ['Research summary.', null]);
});
