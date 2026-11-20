import '@angular/compiler';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createEnvironmentInjector, runInInjectionContext } from '@angular/core';
import { Subject } from 'rxjs';
import { CoreApi, CoreSearchError } from '../.angular/tests/app/data/core-api.js';
import { PaperSearch } from '../.angular/tests/app/data/paper-search.js';

function setup(t) {
  const requests = [];
  const chartRequests = [];
  const injector = createEnvironmentInjector([{ provide: CoreApi, useValue: {
    search: (query, limit) => {
      const response = new Subject();
      requests.push({ query, limit, response });
      return response;
    },
    aggregateYears: (query) => {
      const response = new Subject();
      chartRequests.push({ query, response });
      return response;
    },
  } }], null);
  const search = runInInjectionContext(injector, () => new PaperSearch());
  t.after(() => { if (!injector.destroyed) injector.destroy(); });
  return { search, requests, chartRequests, injector };
}

test('does not fetch on construction or for whitespace-only input', (t) => {
  const { search, requests } = setup(t);
  assert.equal(search.state().status, 'idle');
  search.submit('   ');
  assert.equal(requests.length, 0);
  assert.ok(search.inputError());
});

test('captures the submitted query and distinguishes loaded papers from matching totals', (t) => {
  const { search, requests } = setup(t);
  search.submit('  drones  ');
  assert.deepEqual(search.state(), { status: 'loading', query: 'drones', limit: 10 });
  assert.equal(search.canSearch(), true);
  const results = { papers: [{ title: 'Paper' }], totalHits: 1000 };
  requests[0].response.next(results);
  requests[0].response.complete();
  assert.deepEqual(search.state(), { status: 'success', query: 'drones', limit: 10, results });
  assert.match(search.announcement(), /1 paper loaded/);
  assert.equal(search.canSearch(), true);
});

test('does not issue duplicate requests while a search is in progress', (t) => {
  const { search, requests } = setup(t);
  search.submit('first topic');
  search.submit('first topic');
  assert.equal(requests.length, 1);
  assert.equal(search.state().query, 'first topic');
});

test('announces empty results without inventing a claim about all matching papers', (t) => {
  const { search, requests } = setup(t);
  search.submit('unusual topic');
  requests[0].response.next({ papers: [], totalHits: null });
  assert.equal(search.state().status, 'success');
  assert.match(search.announcement(), /No papers returned/);
});

test('retry repeats the failed submitted query and clears the error on success', (t) => {
  const { search, requests } = setup(t);
  search.submit('drone');
  requests[0].response.error(new CoreSearchError('network', 'Cannot connect'));
  assert.equal(search.state().status, 'error');
  assert.equal(search.canRetry(), true);
  search.retry();
  assert.equal(requests[1].query, 'drone');
  requests[1].response.next({ papers: [], totalHits: 0 });
  assert.equal(search.state().status, 'success');
});

test('does not retry rejected searches, but allows a new topic', (t) => {
  const { search, requests } = setup(t);
  search.submit('bad query');
  requests[0].response.error(new CoreSearchError('query', 'Invalid query', false));
  search.retry();
  assert.equal(requests.length, 1);
  assert.equal(search.canSearch(), true);
  search.submit('different topic');
  assert.equal(requests.length, 2);
});

test('rate-limit cooldown blocks retries and new queries until the deadline', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
  const { search, requests } = setup(t);
  search.submit('drone');
  requests[0].response.error(new CoreSearchError('rate-limit', 'Please wait', true, 6000));
  assert.equal(search.canSearch(), false);
  assert.equal(search.canRetry(), false);
  search.retry();
  search.submit('another topic');
  assert.equal(requests.length, 1);
  t.mock.timers.tick(5000);
  assert.equal(search.canRetry(), true);
  search.retry();
  assert.equal(requests.length, 2);
});

test('destroying the owner cancels the request and prevents late updates', () => {
  const injector = createEnvironmentInjector([{ provide: CoreApi, useValue: { search: () => response } }], null);
  const response = new Subject();
  const search = runInInjectionContext(injector, () => new PaperSearch());
  search.submit('drone');
  assert.equal(response.observed, true);
  injector.destroy();
  assert.equal(response.observed, false);
  response.next({ papers: [], totalHits: 0 });
  assert.equal(search.state().status, 'loading');
});

test('changing the query cancels the previous request and ignores late results/errors', (t) => {
  const { search, requests } = setup(t);
  search.submit('first topic', 10);
  assert.equal(requests[0].response.observed, true);
  search.submit('second topic', 25);
  assert.equal(requests[0].response.observed, false);
  requests[0].response.next({ papers: [{ title: 'Stale result' }], totalHits: 1 });
  requests[0].response.error(new CoreSearchError('network', 'Old failure'));
  assert.deepEqual(search.state(), { status: 'loading', query: 'second topic', limit: 25 });
  const results = { papers: [{ title: 'Current result' }], totalHits: 100 };
  requests[1].response.next(results);
  assert.deepEqual(search.state(), { status: 'success', query: 'second topic', limit: 25, results });
});

test('changing only the count replaces the pending request; repeating both does not', (t) => {
  const { search, requests } = setup(t);
  assert.equal(search.submit('drone', 10), true);
  assert.equal(search.submit('drone', '10'), false);
  assert.equal(search.submit('drone', '25'), true);
  assert.equal(requests[0].response.observed, false);
  assert.deepEqual(requests.map(({ query, limit }) => ({ query, limit })), [
    { query: 'drone', limit: 10 }, { query: 'drone', limit: 25 },
  ]);
});

test('invalid replacement input reports both errors without canceling the valid search', (t) => {
  const { search, requests } = setup(t);
  search.submit('drone', 10);
  assert.equal(search.submit('(drone AND', 0), false);
  assert.ok(search.inputError());
  assert.ok(search.limitError());
  assert.equal(requests.length, 1);
  assert.equal(requests[0].response.observed, true);
  search.submit('delivery', 25);
  assert.equal(search.inputError(), '');
  assert.equal(search.limitError(), '');
});

test('retry preserves the failed query and count, including the maximum count', (t) => {
  const { search, requests } = setup(t);
  search.submit('(drone AND (package OR delivery))', 100);
  requests[0].response.error(new CoreSearchError('network', 'Connection failed'));
  search.retry();
  assert.equal(requests[1].query, '(drone AND (package OR delivery))');
  assert.equal(requests[1].limit, 100);
});

test('does not shorten a rate-limit deadline beyond the native timer maximum', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
  const { search, requests } = setup(t);
  const interval = 2_147_483_647;
  search.submit('drone');
  requests[0].response.error(new CoreSearchError('rate-limit', 'Wait', true, 1000 + interval + 1000));
  t.mock.timers.tick(interval);
  assert.equal(search.canSearch(), false);
  t.mock.timers.tick(1000);
  assert.equal(search.canSearch(), true);
});

test('year counts cover all query matches rather than the returned paper page', (t) => {
  const { search, requests, chartRequests } = setup(t);
  search.submit('drone', 1);
  assert.equal(search.yearChart().status, 'waiting');
  requests[0].response.next({ papers: [{}], totalHits: 1000 });
  assert.equal(chartRequests[0].query, 'drone');
  chartRequests[0].response.next({ years: [{ year: 2024, count: 900 }], missingYear: 100, totalHits: null });
  assert.equal(search.yearChart().status, 'ready');
  assert.equal(search.yearChart().distribution.accountedCount, 1000);
  assert.equal(search.state().results.papers.length, 1);
});

test('changing only the display count reuses complete year data without another aggregation request', (t) => {
  const { search, requests, chartRequests } = setup(t);
  search.submit('drone', 1);
  requests[0].response.next({ papers: [{}], totalHits: 100 });
  chartRequests[0].response.next({ years: [{ year: 2024, count: 100 }], missingYear: 0, totalHits: null });
  chartRequests[0].response.complete();
  search.submit('drone', 25);
  requests[1].response.next({ papers: [{}, {}], totalHits: 100 });
  assert.equal(chartRequests.length, 1);
  assert.equal(search.yearChart().distribution.accountedCount, 100);
});

test('new queries cancel pending year data and ignore stale aggregation responses', (t) => {
  const { search, requests, chartRequests } = setup(t);
  search.submit('first');
  requests[0].response.next({ papers: [{}], totalHits: 100 });
  search.submit('second');
  assert.equal(chartRequests[0].response.observed, false);
  assert.deepEqual(search.yearChart(), { status: 'waiting', query: 'second' });
  chartRequests[0].response.next({ years: [{ year: 2024, count: 100 }], missingYear: 0, totalHits: null });
  requests[1].response.next({ papers: [{}], totalHits: 200 });
  chartRequests[1].response.next({ years: [{ year: 2023, count: 200 }], missingYear: 0, totalHits: null });
  assert.equal(search.yearChart().query, 'second');
  assert.equal(search.yearChart().distribution.accountedCount, 200);
});

test('partial aggregates are explicitly incomplete rather than inventing missing years', (t) => {
  const { search, requests, chartRequests } = setup(t);
  search.submit('drone');
  requests[0].response.next({ papers: [{}], totalHits: 100 });
  chartRequests[0].response.next({ years: [{ year: 2024, count: 40 }], missingYear: 0, totalHits: null });
  assert.equal(search.yearChart().status, 'incomplete');
  assert.equal(search.yearChart().distribution.unaccountedCount, 60);
  assert.equal(search.yearChart().distribution.missingYear, 0);
});

test('chart failure and retry do not erase papers or repeat the paper request', (t) => {
  const { search, requests, chartRequests } = setup(t);
  search.submit('drone');
  requests[0].response.next({ papers: [{}], totalHits: 100 });
  chartRequests[0].response.error(new CoreSearchError('service', 'Unavailable'));
  assert.equal(search.state().status, 'success');
  assert.equal(search.yearChart().status, 'error');
  assert.equal(search.retryYearChart(), true);
  assert.equal(requests.length, 1);
  assert.equal(chartRequests.length, 2);
  chartRequests[1].response.next({ years: [{ year: 2024, count: 100 }], missingYear: 0, totalHits: null });
  assert.equal(search.yearChart().status, 'ready');
});

test('aggregation rate limits pause only chart requests and survive query changes', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
  const { search, requests, chartRequests } = setup(t);
  search.submit('first');
  requests[0].response.next({ papers: [{}], totalHits: 100 });
  chartRequests[0].response.error(new CoreSearchError('rate-limit', 'Wait', true, 601000));
  assert.equal(search.canRetryYearChart(), false);
  assert.equal(search.canSearch(), true);
  search.submit('second');
  requests[1].response.next({ papers: [{}], totalHits: 100 });
  assert.equal(chartRequests.length, 1);
  assert.equal(search.yearChart().query, 'second');
  t.mock.timers.tick(600000);
  assert.equal(chartRequests.length, 1);
  assert.equal(search.canRetryYearChart(), true);
  search.retryYearChart();
  assert.equal(chartRequests.length, 2);
});

test('zero matches produce an empty complete distribution without spending an aggregation request', (t) => {
  const { search, requests, chartRequests } = setup(t);
  search.submit('unusual topic');
  requests[0].response.next({ papers: [], totalHits: 0 });
  assert.equal(chartRequests.length, 0);
  assert.equal(search.yearChart().status, 'ready');
  assert.equal(search.yearChart().distribution.accountedCount, 0);
});

test('destroying the search owner also cancels year aggregation', (t) => {
  const { search, requests, chartRequests, injector } = setup(t);
  search.submit('drone');
  requests[0].response.next({ papers: [{}], totalHits: 100 });
  assert.equal(chartRequests[0].response.observed, true);
  injector.destroy();
  assert.equal(chartRequests[0].response.observed, false);
});

test('a pending aggregation is reused across count changes and reconciled against the latest total', (t) => {
  const { search, requests, chartRequests } = setup(t);
  search.submit('drone', 1);
  requests[0].response.next({ papers: [{}], totalHits: 100 });
  search.submit('drone', 25);
  requests[1].response.next({ papers: [{}, {}], totalHits: 200 });
  assert.equal(chartRequests.length, 1);
  chartRequests[0].response.next({ years: [{ year: 2024, count: 100 }], missingYear: 0, totalHits: null });
  assert.equal(search.yearChart().status, 'incomplete');
  assert.equal(search.yearChart().distribution.expectedTotal, 200);
  assert.equal(search.state().limit, 25);
});

test('refreshing incomplete year data preserves the paper page and checks coverage again', (t) => {
  const { search, requests, chartRequests } = setup(t);
  search.submit('drone');
  requests[0].response.next({ papers: [{}], totalHits: 100 });
  chartRequests[0].response.next({ years: [{ year: 2024, count: 40 }], missingYear: 0, totalHits: null });
  chartRequests[0].response.complete();
  assert.equal(search.retryYearChart(), true);
  assert.equal(requests.length, 1);
  chartRequests[1].response.next({ years: [{ year: 2024, count: 100 }], missingYear: 0, totalHits: null });
  assert.equal(search.yearChart().status, 'ready');
});

test('a complete unique paper set builds the full timeline without an aggregation call', (t) => {
  const { search, requests, chartRequests } = setup(t);
  search.submit('small query', 25);
  requests[0].response.next({ totalHits: 2, papers: [{ id: '1', year: 2024 }, { id: '2', year: null }] });
  assert.equal(chartRequests.length, 0);
  assert.equal(search.yearChart().status, 'ready');
  assert.equal(search.yearChart().distribution.accountedCount, 2);
  assert.equal(search.yearChart().distribution.missingYear, 1);
});

test('receiving every match cancels an older pending aggregation and ignores its result', (t) => {
  const { search, requests, chartRequests } = setup(t);
  search.submit('small query', 1);
  requests[0].response.next({ totalHits: 2, papers: [{ id: '1', year: 2024 }] });
  search.submit('small query', 2);
  requests[1].response.next({ totalHits: 2, papers: [{ id: '1', year: 2024 }, { id: '2', year: 2023 }] });
  assert.equal(chartRequests[0].response.observed, false);
  chartRequests[0].response.next({ years: [{ year: 2020, count: 2 }], missingYear: 0, totalHits: null });
  assert.deepEqual(search.yearChart().distribution.years, [{ year: 2024, count: 1 }, { year: 2023, count: 1 }]);
});
