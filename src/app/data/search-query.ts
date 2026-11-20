export const DEFAULT_RESULT_LIMIT = 10;
export const MIN_RESULT_LIMIT = 1;
export const MAX_RESULT_LIMIT = 100;
export const MAX_QUERY_LENGTH = 500;
export const BOOLEAN_EXAMPLE = '(drone AND (package OR delivery))';

export interface SearchRequest {
  readonly query: string;
  readonly limit: number;
}

export interface SearchValidation {
  readonly request: SearchRequest | null;
  readonly queryError: string;
  readonly limitError: string;
}

type Token = 'term' | '(' | ')' | 'AND' | 'OR' | 'NOT';

class QuerySyntaxError extends Error {}

function* queryTokens(query: string): Generator<Token> {
  let index = 0;
  while (index < query.length) {
    const char = query[index];
    if (/\s/.test(char)) { index++; continue; }
    if (char === '(' || char === ')') { index++; yield char; continue; }
    if (char === '"') {
      index++;
      let content = '';
      while (index < query.length && query[index] !== '"') {
        if (query[index] === '\\') {
          index++;
          if (index === query.length) throw new QuerySyntaxError('Finish the escaped character at the end of the query.');
        }
        content += query[index++];
      }
      if (index === query.length) throw new QuerySyntaxError('Close the quotation marks around your phrase.');
      if (!content.trim()) throw new QuerySyntaxError('Put some words inside quotation marks.');
      index++;
      yield 'term';
      continue;
    }
    const start = index;
    while (index < query.length && !/[\s()"]/.test(query[index])) {
      if (query[index] === '\\') {
        index++;
        if (index === query.length) throw new QuerySyntaxError('Finish the escaped character at the end of the query.');
      }
      index++;
    }
    const word = query.slice(start, index);
    yield word === 'AND' || word === 'OR' || word === 'NOT' ? word : 'term';
  }
}

export function validateQuery(query: string): string {
  if (!query.trim()) return 'Enter a topic to search for.';
  if (query.length > MAX_QUERY_LENGTH) return `Keep your query to ${MAX_QUERY_LENGTH} characters or fewer.`;
  if (/[\u0000-\u001f\u007f]/.test(query)) return 'Use a single-line search query.';
  let depth = 0;
  let needsTerm = true;
  try {
    for (const token of queryTokens(query)) {
      if (token === '(') { depth++; needsTerm = true; }
      else if (token === ')') {
        if (!depth) return 'Remove the extra closing parenthesis.';
        if (needsTerm) return 'Add a search term before closing the group.';
        depth--;
        needsTerm = false;
      } else if (token === 'AND' || token === 'OR') {
        if (needsTerm) return `Add a search term before ${token}.`;
        needsTerm = true;
      } else if (token === 'NOT') {
        needsTerm = true;
      } else {
        needsTerm = false;
      }
    }
  } catch (error) {
    if (error instanceof QuerySyntaxError) return error.message;
    throw error;
  }
  if (depth) return 'Close each opening parenthesis.';
  if (needsTerm) return 'Add a search term after the Boolean operator.';
  return '';
}

export function validateSearchInput(rawQuery: string, rawLimit: unknown = DEFAULT_RESULT_LIMIT): SearchValidation {
  const query = rawQuery.trim();
  const queryError = validateQuery(query);
  const limit = typeof rawLimit === 'number' ? rawLimit
    : typeof rawLimit === 'string' && /^\d+$/.test(rawLimit.trim()) ? Number(rawLimit.trim()) : NaN;
  const limitError = Number.isSafeInteger(limit) && limit >= MIN_RESULT_LIMIT && limit <= MAX_RESULT_LIMIT
    ? '' : `Choose a whole number from ${MIN_RESULT_LIMIT} to ${MAX_RESULT_LIMIT}.`;
  return { queryError, limitError, request: queryError || limitError ? null : { query, limit } };
}
