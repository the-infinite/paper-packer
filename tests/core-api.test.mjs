import '@angular/compiler';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createEnvironmentInjector, runInInjectionContext } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { firstValueFrom, NEVER, of, throwError } from 'rxjs';
import { CoreApi, CORE_PAGE_SIZE, CORE_SEARCH_URL, CORE_TIMEOUT_MS, searchError } from '../.angular/tests/app/data/core-api.js';

function apiWith(t, http, timeoutMs = 30000) {
  const injector = createEnvironmentInjector([
    { provide: HttpClient, useValue: http },
    { provide: CORE_TIMEOUT_MS, useValue: timeoutMs },
  ], null);
  t.after(() => injector.destroy());
  return runInInjectionContext(injector, () => new CoreApi());
}

test('makes an anonymous GET with an encoded query and a fixed ten-paper limit', async (t) => {
  let request;
  const api = apiWith(t, { get: (url, options) => {
    request = { url, options };
    return of({ totalHits: 1, results: [{ id: 123, title: 'Research' }] });
  } });
  const result = await firstValueFrom(api.search('  climate & health  '));
  assert.equal(request.url, CORE_SEARCH_URL);
  assert.equal(request.options.params.get('q'), 'climate & health');
  assert.equal(request.options.params.get('limit'), String(CORE_PAGE_SIZE));
  assert.equal(request.options.params.get('exclude'), 'fullText');
  assert.match(request.options.params.toString(), /q=climate%20%26%20health/);
  assert.equal(request.options.headers, undefined);
  assert.equal(result.papers[0].title, 'Research');
});

test('does not send empty searches', async (t) => {
  const api = apiWith(t, { get: () => { throw new Error('Should not request'); } });
  await assert.rejects(firstValueFrom(api.search('   ')), { kind: 'query', retryable: false });
});

test('treats malformed success responses as an error instead of no results', async (t) => {
  const api = apiWith(t, { get: () => of({ message: 'Unavailable' }) });
  await assert.rejects(firstValueFrom(api.search('drone')), { kind: 'response' });
});

test('times out requests that never return', async (t) => {
  const api = apiWith(t, { get: () => NEVER }, 1);
  await assert.rejects(firstValueFrom(api.search('drone')), { kind: 'timeout', retryable: true });
});

test('maps HTTP failures into actionable errors without exposing provider bodies', async (t) => {
  for (const [status, kind, retryable] of [[0, 'network', true], [400, 'query', false],
    [422, 'query', false], [401, 'access', false], [403, 'access', false], [503, 'service', true]]) {
    const api = apiWith(t, { get: () => throwError(() => new HttpErrorResponse({ status, error: 'private provider detail' })) });
    await assert.rejects(firstValueFrom(api.search('drone')), (error) => {
      assert.equal(error.kind, kind);
      assert.equal(error.retryable, retryable);
      assert.equal(error.message.includes('private provider detail'), false);
      return true;
    });
  }
});

test('honors Retry-After seconds and CORE retry-date headers, with a fallback cooldown', () => {
  const before = Date.now();
  const seconds = searchError(new HttpErrorResponse({ status: 429, headers: new HttpHeaders({ 'Retry-After': '120' }) }));
  assert.equal(seconds.kind, 'rate-limit');
  assert.ok(seconds.retryAt >= before + 120000 && seconds.retryAt <= Date.now() + 120000);
  const deadline = new Date(Date.now() + 180000).toUTCString();
  const date = searchError(new HttpErrorResponse({ status: 429, headers: new HttpHeaders({ 'X-RateLimit-Retry-After': deadline }) }));
  assert.equal(date.retryAt, Date.parse(deadline));
  const fallback = searchError(new HttpErrorResponse({ status: 429 }));
  assert.ok(fallback.retryAt >= before + 60000);
});
