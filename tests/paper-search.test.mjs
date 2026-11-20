import '@angular/compiler';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createEnvironmentInjector, runInInjectionContext } from '@angular/core';
import { Subject } from 'rxjs';
import { CoreApi, CoreSearchError } from '../.angular/tests/app/data/core-api.js';
import { PaperSearch } from '../.angular/tests/app/data/paper-search.js';

function setup(t) {
  const requests = [];
  const injector = createEnvironmentInjector([{ provide: CoreApi, useValue: {
    search: (query) => {
      const response = new Subject();
      requests.push({ query, response });
      return response;
    },
  } }], null);
  const search = runInInjectionContext(injector, () => new PaperSearch());
  t.after(() => injector.destroy());
  return { search, requests, injector };
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
  assert.deepEqual(search.state(), { status: 'loading', query: 'drones' });
  assert.equal(search.canSearch(), false);
  const results = { papers: [{ title: 'Paper' }], totalHits: 1000 };
  requests[0].response.next(results);
  requests[0].response.complete();
  assert.deepEqual(search.state(), { status: 'success', query: 'drones', results });
  assert.match(search.announcement(), /1 paper loaded/);
  assert.equal(search.canSearch(), true);
});

test('does not issue duplicate requests while a search is in progress', (t) => {
  const { search, requests } = setup(t);
  search.submit('first topic');
  search.submit('second topic');
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
