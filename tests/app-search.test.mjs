import '@angular/compiler';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createEnvironmentInjector, DOCUMENT, runInInjectionContext } from '@angular/core';
import { Subject } from 'rxjs';
import { App } from '../.angular/tests/app/app.js';
import { CoreApi, CoreSearchError } from '../.angular/tests/app/data/core-api.js';
import { PaperSearch } from '../.angular/tests/app/data/paper-search.js';
import { BOOLEAN_EXAMPLE } from '../.angular/tests/app/data/search-query.js';

function setup(t, href = 'https://example.org/?source=shared#workspace', copy = async () => {}) {
  const requests = [];
  const replaced = [];
  const browser = {
    location: { href },
    history: {
      state: { existing: 'preserved' },
      replaceState(state, _title, next) {
        replaced.push({ state, href: next });
        browser.location.href = next;
      },
    },
    navigator: { clipboard: { writeText: copy } },
  };
  const injector = createEnvironmentInjector([
    { provide: DOCUMENT, useValue: { defaultView: browser } },
    { provide: CoreApi, useValue: { search(query, limit) {
      const response = new Subject();
      requests.push({ query, limit, response });
      return response;
    } } },
    PaperSearch,
  ], null);
  t.after(() => injector.destroy());
  const app = runInInjectionContext(injector, () => new App());
  return { app, requests, browser, replaced };
}

test('restores and submits a valid shared Boolean query and selected count', (t) => {
  const url = new URL('https://example.org/');
  url.searchParams.set('q', BOOLEAN_EXAMPLE);
  url.searchParams.set('limit', '25');
  const { app, requests, replaced } = setup(t, url.href);
  assert.equal(app.query(), BOOLEAN_EXAMPLE);
  assert.equal(app.resultLimit(), '25');
  assert.equal(requests[0].query, BOOLEAN_EXAMPLE);
  assert.equal(requests[0].limit, 25);
  assert.equal(app.canSubmit(), false);
  assert.equal(replaced.length, 0);
});

test('fresh visits and invalid shared links send no request; invalid fields stay editable', (t) => {
  const fresh = setup(t);
  assert.equal(fresh.requests.length, 0);
  const invalid = setup(t, 'https://example.org/?q=(drone&limit=101');
  assert.equal(invalid.requests.length, 0);
  assert.equal(invalid.app.query(), '(drone');
  assert.equal(invalid.app.resultLimit(), '101');
  assert.ok(invalid.app.search.inputError());
  assert.ok(invalid.app.search.limitError());
});

test('valid submission updates query/count in the URL, while invalid input leaves it unchanged', (t) => {
  const { app, requests, browser, replaced } = setup(t);
  let prevented = false;
  app.query.set(BOOLEAN_EXAMPLE);
  app.resultLimit.set('25');
  app.submit({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  const current = new URL(browser.location.href);
  assert.equal(current.searchParams.get('q'), BOOLEAN_EXAMPLE);
  assert.equal(current.searchParams.get('limit'), '25');
  assert.equal(current.searchParams.get('source'), 'shared');
  assert.equal(current.hash, '#workspace');
  assert.deepEqual(replaced[0].state, { existing: 'preserved' });
  app.query.set('drone AND');
  app.submit({ preventDefault() {} });
  assert.equal(replaced.length, 1);
  assert.equal(requests.length, 1);
  assert.ok(app.search.inputError());
});

test('pending identical input disables submit, but changing the query or count enables replacement', (t) => {
  const { app, requests } = setup(t);
  app.query.set('drone');
  app.submit({ preventDefault() {} });
  assert.equal(app.canSubmit(), false);
  app.submit({ preventDefault() {} });
  assert.equal(requests.length, 1);
  app.resultLimit.set('25');
  assert.equal(app.canSubmit(), true);
  app.submit({ preventDefault() {} });
  assert.equal(requests[0].response.observed, false);
  assert.equal(requests[1].limit, 25);
  app.query.set('delivery');
  assert.equal(app.canSubmit(), true);
});

test('retry restores the failed query/count in both controls and URL instead of submitting unsent edits', (t) => {
  const { app, requests, browser } = setup(t);
  app.query.set('drone');
  app.resultLimit.set('50');
  app.submit({ preventDefault() {} });
  requests[0].response.error(new CoreSearchError('network', 'Failed'));
  app.query.set('unsent changes');
  app.resultLimit.set('1');
  app.retry();
  assert.equal(app.query(), 'drone');
  assert.equal(app.resultLimit(), '50');
  assert.equal(requests[1].query, 'drone');
  assert.equal(requests[1].limit, 50);
  assert.equal(new URL(browser.location.href).searchParams.get('limit'), '50');
});

test('the guide example fills and focuses the query without sending a request', (t) => {
  const { app, requests } = setup(t);
  let focused = false;
  app.useExample({ focus() { focused = true; } });
  assert.equal(app.query(), BOOLEAN_EXAMPLE);
  assert.equal(focused, true);
  assert.equal(requests.length, 0);
});

test('copying uses submitted query/count rather than unsent edits and handles clipboard rejection', async (t) => {
  let copied;
  const { app } = setup(t, 'https://example.org/', async (value) => { copied = value; });
  app.query.set('drone');
  app.resultLimit.set('25');
  app.submit({ preventDefault() {} });
  app.query.set('unsent topic');
  await app.copyLink();
  assert.equal(new URL(copied).searchParams.get('q'), 'drone');
  assert.equal(new URL(copied).searchParams.get('limit'), '25');
  assert.equal(app.copyMessage(), 'Search link copied.');
  const blocked = setup(t, 'https://example.org/?q=drone', async () => { throw new Error('Denied'); });
  await blocked.app.copyLink();
  assert.equal(blocked.app.copyMessage(), 'Copy the search link from the address bar.');
});

test('a slow clipboard operation cannot announce completion for a newer search', async (t) => {
  let finish;
  const { app } = setup(t, 'https://example.org/', () => new Promise((resolve) => { finish = resolve; }));
  app.query.set('drone');
  app.submit({ preventDefault() {} });
  const copy = app.copyLink();
  app.query.set('delivery');
  app.submit({ preventDefault() {} });
  finish();
  await copy;
  assert.equal(app.copyMessage(), '');
});
