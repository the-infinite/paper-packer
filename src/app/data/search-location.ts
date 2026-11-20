import { DEFAULT_RESULT_LIMIT, SearchRequest } from './search-query.js';

export interface SearchLocation {
  readonly query: string;
  readonly limit: string;
  readonly hasQuery: boolean;
}

export function readSearchLocation(href: string): SearchLocation {
  const params = new URL(href).searchParams;
  return {
    query: params.get('q') ?? '',
    limit: params.get('limit') ?? String(DEFAULT_RESULT_LIMIT),
    hasQuery: params.has('q'),
  };
}

export function writeSearchLocation(href: string, request: SearchRequest): string {
  const url = new URL(href);
  url.searchParams.set('q', request.query);
  url.searchParams.set('limit', String(request.limit));
  return url.href;
}
