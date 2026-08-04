/**
 * Researching a topic before the course exists.
 *
 * The teacher types "colorimetría de pinturas de paredes" on the wizard and
 * expects material, not an errand for the agent. What matters here is that the
 * run is *robust*: a dead link, a paywall or a search that returns junk must cost
 * one page, never the whole research — a course built from eight good pages beats
 * an error message. And the harvest has to arrive as DRAFT documents, the same
 * currency an uploaded PDF uses on that screen, or researched pages become a
 * second parallel notion of "material" that the Sources panel never shows.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AIProvider } from '@cio/ai-assistant';

const searchWeb = vi.fn();
const fetchDocumentationUrl = vi.fn();
const storeDraftDocument = vi.fn();
const generateObject = vi.fn();

vi.mock('@api/services/agent/web-search', async () => {
  const actual = await vi.importActual<typeof import('@api/services/agent/web-search')>(
    '@api/services/agent/web-search'
  );

  return { ...actual, searchWeb: (...args: unknown[]) => searchWeb(...args) };
});

vi.mock('@api/services/agent/fetch-url', () => ({
  fetchDocumentationUrl: (...args: unknown[]) => fetchDocumentationUrl(...args)
}));

vi.mock('@api/services/agent/document', () => ({
  URL_SOURCE_MIME_TYPE: 'text/markdown',
  storeDraftDocument: (...args: unknown[]) => storeDraftDocument(...args)
}));

vi.mock('ai', () => ({
  generateObject: (...args: unknown[]) => generateObject(...args)
}));

vi.mock('@api/config/env', () => ({ env: { JINA_API_KEY: 'key' } }));

vi.mock('@api/utils/redis/redis', () => ({
  redis: { isOpen: false, get: vi.fn(), set: vi.fn() },
  logRedisUnavailableOnce: vi.fn()
}));

const { runResearch, deriveSearchQueries } = await import('@api/services/agent/research');

const PROVIDER = { provider: AIProvider.MINIMAX, apiKey: 'k' };
const REDIS = {} as never;

const BASE = {
  orgId: 'org-1',
  userId: 'teacher-1',
  redis: REDIS,
  providerConfig: PROVIDER
};

function page(url: string, content = 'x'.repeat(1000)) {
  return { url, pageTitle: `Título de ${url}`, content, links: [], contentTokens: 10, fetchedAt: '', cacheHit: false };
}

beforeEach(() => {
  vi.clearAllMocks();
  generateObject.mockResolvedValue({ object: { queries: ['q1', 'q2'] } });
  storeDraftDocument.mockImplementation(async () => ({ documentId: `doc-${storeDraftDocument.mock.calls.length}` }));
});

describe('deriveSearchQueries', () => {
  it('falls back to the raw topic instead of cancelling the research', async () => {
    generateObject.mockRejectedValueOnce(new Error('model unavailable'));

    const queries = await deriveSearchQueries('colorimetría de pinturas', 'normal', PROVIDER);

    expect(queries).toEqual(['colorimetría de pinturas']);
  });
});

describe('runResearch', () => {
  it('saves every readable page as a draft source', async () => {
    searchWeb.mockResolvedValue([
      { url: 'https://a.com/1', title: 'A', snippet: '' },
      { url: 'https://b.com/1', title: 'B', snippet: '' }
    ]);
    fetchDocumentationUrl.mockImplementation(async ({ url }: { url: string }) => page(url));

    const outcome = await runResearch({ ...BASE, topic: 'colorimetría', depth: 'quick' });

    expect(outcome.sources).toHaveLength(2);
    expect(outcome.failedCount).toBe(0);
    expect(storeDraftDocument).toHaveBeenCalledTimes(2);
  });

  it('loses one page, not the research, when a fetch fails', async () => {
    searchWeb.mockResolvedValue([
      { url: 'https://good.com/1', title: 'good', snippet: '' },
      { url: 'https://dead.com/1', title: 'dead', snippet: '' }
    ]);
    fetchDocumentationUrl.mockImplementation(async ({ url }: { url: string }) => {
      if (url.includes('dead')) throw new Error('502');

      return page(url);
    });

    const outcome = await runResearch({ ...BASE, topic: 'colorimetría', depth: 'quick' });

    expect(outcome.sources.map((s) => s.url)).toEqual(['https://good.com/1']);
    expect(outcome.failedCount).toBe(1);
  });

  it('keeps going when one of the searches fails', async () => {
    searchWeb
      .mockRejectedValueOnce(new Error('rate limited'))
      .mockResolvedValueOnce([{ url: 'https://b.com/1', title: 'B', snippet: '' }]);
    fetchDocumentationUrl.mockImplementation(async ({ url }: { url: string }) => page(url));

    const outcome = await runResearch({ ...BASE, topic: 'colorimetría', depth: 'quick' });

    expect(outcome.sources).toHaveLength(1);
  });

  it('discards a page with nothing on it rather than storing an empty source', async () => {
    searchWeb.mockResolvedValue([{ url: 'https://thin.com/1', title: 'thin', snippet: '' }]);
    fetchDocumentationUrl.mockResolvedValue(page('https://thin.com/1', 'demasiado corto'));

    const outcome = await runResearch({ ...BASE, topic: 'colorimetría', depth: 'quick' });

    expect(outcome.sources).toHaveLength(0);
    expect(outcome.failedCount).toBe(1);
    expect(storeDraftDocument).not.toHaveBeenCalled();
  });

  it('never reads more pages than the chosen depth allows', async () => {
    searchWeb.mockResolvedValue(
      Array.from({ length: 20 }, (_, i) => ({ url: `https://a.com/${i}`, title: `${i}`, snippet: '' }))
    );
    fetchDocumentationUrl.mockImplementation(async ({ url }: { url: string }) => page(url));

    const outcome = await runResearch({ ...BASE, topic: 'colorimetría', depth: 'quick' });

    expect(outcome.sources).toHaveLength(5);
    expect(fetchDocumentationUrl).toHaveBeenCalledTimes(5);
  });

  it('returns nothing to build on when the searches come back empty', async () => {
    searchWeb.mockResolvedValue([]);

    const outcome = await runResearch({ ...BASE, topic: 'colorimetría', depth: 'normal' });

    expect(outcome.sources).toEqual([]);
    expect(fetchDocumentationUrl).not.toHaveBeenCalled();
  });
});
