import { Parser } from 'htmlparser2';

export interface Paper {
  readonly id: string | null;
  readonly title: string;
  readonly authors: readonly string[];
  readonly abstract: string | null;
  readonly year: number | null;
  readonly recordUrl: string | null;
  readonly fullTextUrl: string | null;
}

export interface PaperResults {
  readonly papers: readonly Paper[];
  readonly totalHits: number | null;
}

export class InvalidCoreResponseError extends Error {
  constructor() {
    super('CORE returned an unexpected response.');
    this.name = 'InvalidCoreResponseError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

const hiddenTags = new Set(['script', 'style', 'template']);
const blockTags = new Set(['p', 'div', 'br', 'li', 'ul', 'ol', 'blockquote', 'section', 'h1', 'h2', 'h3']);
const encodedMarkup = /(?:<|&lt;)\/?(?:p|div|br|span|em|strong|b|i|sup|sub|ul|ol|li|script|style|template)\b/i;

function markupText(value: string): string {
  const parts: string[] = [];
  let hiddenDepth = 0;
  const parser = new Parser({
    onopentag(name) {
      if (hiddenTags.has(name)) hiddenDepth++;
      else if (!hiddenDepth && blockTags.has(name)) parts.push('\n');
    },
    ontext(content) {
      if (!hiddenDepth) parts.push(content);
    },
    onclosetag(name) {
      if (hiddenTags.has(name)) hiddenDepth = Math.max(0, hiddenDepth - 1);
      else if (!hiddenDepth && blockTags.has(name)) parts.push('\n');
    },
  }, { decodeEntities: true });
  parser.end(value);
  return parts.join('');
}

function abstractText(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  // Parse text in memory, never in a browser document: provider markup cannot
  // execute scripts or load resources. Some CORE sources encode the markup too.
  let result = markupText(raw);
  for (let pass = 0; pass < 2 && encodedMarkup.test(result); pass++) result = markupText(result);
  return result.replace(/[\t \u00a0]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim() || null;
}

export function safeExternalUrl(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

function paperId(value: unknown): string | null {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return String(value);
  return typeof value === 'string' && /^[1-9]\d*$/.test(value) ? value : null;
}

function publicationYear(value: unknown): number | null {
  const year = typeof value === 'string' && /^\d{4}$/.test(value) ? Number(value) : value;
  return typeof year === 'number' && Number.isInteger(year) && year >= 1000 && year <= 9999
    ? year : null;
}

function dateYear(value: unknown): number | null {
  const date = text(value);
  if (!date || !/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(date) || !Number.isFinite(Date.parse(date))) return null;
  const day = date.slice(0, 10);
  if (new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) !== day) return null;
  return publicationYear(date.slice(0, 4));
}

function normalizePaper(value: unknown): Paper {
  if (!isRecord(value)) throw new InvalidCoreResponseError();
  const id = paperId(value['id']);
  const authors = Array.isArray(value['authors'])
    ? value['authors'].map((author: unknown) => isRecord(author) ? text(author['name']) : text(author))
      .filter((name): name is string => name !== null)
    : [];
  const sources: unknown[] = Array.isArray(value['sourceFulltextUrls']) ? value['sourceFulltextUrls'] : [];
  const fullTextUrl = [value['downloadUrl'], ...sources].map(safeExternalUrl).find((url) => url !== null) ?? null;

  return {
    id,
    title: text(value['title']) ?? 'Untitled paper',
    authors: [...new Set(authors)],
    abstract: abstractText(value['abstract']),
    year: publicationYear(value['yearPublished']) ?? dateYear(value['publishedDate']),
    recordUrl: id ? `https://core.ac.uk/works/${id}` : null,
    fullTextUrl,
  };
}

export function normalizeCoreResults(value: unknown): PaperResults {
  if (!isRecord(value) || !Array.isArray(value['results'])) throw new InvalidCoreResponseError();
  const papers = value['results'].map(normalizePaper);
  const total = value['totalHits'];
  const totalHits = typeof total === 'number' && Number.isSafeInteger(total) && total >= papers.length
    ? total : null;
  return { papers, totalHits };
}
