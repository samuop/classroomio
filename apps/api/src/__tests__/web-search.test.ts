/**
 * Web search: the one primitive the course agent was missing.
 *
 * Everything downstream of "here is a URL" already existed — the reader, the
 * 7-day cache, the Sources panel, the source pack. These tests pin the two parts
 * that are easy to get wrong and impossible to notice: an unconfigured install
 * must say WHICH variable is missing, and the merge must not let the same page
 * be fetched, stored and billed three times because a search engine returned it
 * with three different query strings.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const env: { JINA_API_KEY?: string } = {};

vi.mock('@api/config/env', () => ({
  get env() {
    return env;
  }
}));

vi.mock('@api/utils/redis/redis', () => ({
  redis: { isOpen: false, get: vi.fn(), set: vi.fn() },
  logRedisUnavailableOnce: vi.fn()
}));

const { searchWeb, mergeSearchResults, WEB_SEARCH_UNCONFIGURED, isWebSearchConfigured } = await import(
  '@api/services/agent/web-search'
);

function jinaResponse(entries: { url: string; title?: string; description?: string }[]) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ data: entries })
  } as unknown as Response;
}

beforeEach(() => {
  vi.restoreAllMocks();
  delete env.JINA_API_KEY;
});

describe('searchWeb', () => {
  it('names the missing variable instead of failing generically', async () => {
    await expect(searchWeb({ query: 'colorimetría de pinturas' })).rejects.toThrow(/JINA_API_KEY/);
    expect(WEB_SEARCH_UNCONFIGURED).toContain('JINA_API_KEY');
    expect(isWebSearchConfigured()).toBe(false);
  });

  it('asks for links only, so pages are read through the one path that caches and sandboxes them', async () => {
    env.JINA_API_KEY = 'key';
    const fetchMock = vi.fn(async () => jinaResponse([{ url: 'https://example.com/a', title: 'A' }]));
    vi.stubGlobal('fetch', fetchMock);

    await searchWeb({ query: 'colorimetría' });

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)['X-Respond-With']).toBe('no-content');
  });

  it('drops results the reader would refuse, at discovery time', async () => {
    env.JINA_API_KEY = 'key';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jinaResponse([
          { url: 'http://localhost:3000/admin', title: 'internal' },
          { url: 'http://169.254.169.254/latest/meta-data', title: 'metadata' },
          { url: 'https://example.com/real', title: 'real' }
        ])
      )
    );

    const results = await searchWeb({ query: 'anything' });

    expect(results.map((r) => r.url)).toEqual(['https://example.com/real']);
  });

  it('reports a failing search service rather than returning nothing', async () => {
    env.JINA_API_KEY = 'key';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 429, text: async () => 'rate limited' }) as unknown as Response)
    );

    await expect(searchWeb({ query: 'anything' })).rejects.toThrow(/429/);
  });
});

describe('mergeSearchResults', () => {
  const result = (url: string) => ({ url, title: url, snippet: '' });

  it('counts one page once, however the search engine decorated its URL', () => {
    const merged = mergeSearchResults(
      [
        [result('https://example.com/guia'), result('https://example.com/guia?utm_source=x')],
        [result('https://example.com/guia/'), result('https://example.com/guia#seccion')]
      ],
      10
    );

    expect(merged).toHaveLength(1);
  });

  it('takes the best of every query before the long tail of any one of them', () => {
    const merged = mergeSearchResults(
      [
        [result('https://a.com/1'), result('https://a.com/2'), result('https://a.com/3')],
        [result('https://b.com/1'), result('https://b.com/2')]
      ],
      4
    );

    expect(merged.map((r) => r.url)).toEqual([
      'https://a.com/1',
      'https://b.com/1',
      'https://a.com/2',
      'https://b.com/2'
    ]);
  });

  it('stops at the budget', () => {
    const merged = mergeSearchResults([[result('https://a.com/1'), result('https://a.com/2')]], 1);

    expect(merged).toHaveLength(1);
  });
});
