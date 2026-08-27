/**
 * Web search: the one primitive the course agent was missing.
 *
 * Everything downstream of "here is a URL" already existed — the reader, the
 * 7-day cache, the Sources panel, the source pack. What these tests pin is the
 * seam that grounding introduced: Gemini never hands back the page's own address,
 * only an expiring `vertexaisearch.cloud.google.com` redirect whose title is the
 * bare domain. Every guard we had ran on the URL the search returned, and every
 * one of them would now be inspecting Google instead of the page underneath.
 *
 * So: the redirect must be resolved, the guards must run on what it resolves to,
 * and a citation we cannot resolve must be dropped rather than stored — an
 * address that expires looks like a source right up until someone clicks it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getWebSearchModel = vi.fn();
const generateText = vi.fn();

vi.mock('@cio/ai-assistant', () => ({
  getWebSearchModel: () => getWebSearchModel()
}));

vi.mock('ai', () => ({
  generateText: (...args: unknown[]) => generateText(...args)
}));

vi.mock('@api/utils/redis/redis', () => ({
  redis: { isOpen: false, get: vi.fn(), set: vi.fn() },
  logRedisUnavailableOnce: vi.fn()
}));

const { searchWeb, groundedSearch, mergeSearchResults, WEB_SEARCH_UNCONFIGURED, isWebSearchConfigured } = await import(
  '@api/services/agent/web-search'
);

const REDIRECT = 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/';

type Chunk = { uri: string; title?: string };

function grounded(
  chunks: Chunk[],
  extra: {
    webSearchQueries?: string[];
    groundingSupports?: { segment?: { text?: string }; groundingChunkIndices?: number[] }[];
  } = {}
) {
  return {
    providerMetadata: {
      google: {
        groundingMetadata: {
          webSearchQueries: extra.webSearchQueries ?? ['una búsqueda'],
          groundingChunks: chunks.map((chunk) => ({ web: { uri: chunk.uri, title: chunk.title ?? 'ejemplo.com' } })),
          groundingSupports: extra.groundingSupports ?? []
        }
      }
    }
  };
}

/**
 * A hop that never downloads the page: `redirect: 'manual'` leaves the
 * destination in the Location header, which is the whole string we want.
 */
function redirectsTo(destinations: Record<string, string | null>) {
  return vi.fn(async (uri: string) => ({
    headers: {
      get: (name: string) => (name.toLowerCase() === 'location' ? (destinations[uri] ?? null) : null)
    },
    body: null
  })) as unknown as typeof fetch;
}

beforeEach(() => {
  vi.restoreAllMocks();
  process.env.GOOGLE_API_KEY = 'key';
  getWebSearchModel.mockReturnValue({ model: 'gemini', searchTool: {} });
  generateText.mockResolvedValue(grounded([]));
});

describe('searchWeb', () => {
  it('names the missing variable instead of failing generically', async () => {
    delete process.env.GOOGLE_API_KEY;
    getWebSearchModel.mockReturnValue(null);

    await expect(searchWeb({ query: 'colorimetría de pinturas' })).rejects.toThrow(/GOOGLE_API_KEY/);
    expect(WEB_SEARCH_UNCONFIGURED).toContain('GOOGLE_API_KEY');
    expect(isWebSearchConfigured()).toBe(false);
  });

  it('stores the page address, not the expiring Google redirect that stands in for it', async () => {
    generateText.mockResolvedValue(grounded([{ uri: `${REDIRECT}AXiHM1`, title: 'wikipedia.org' }]));
    vi.stubGlobal('fetch', redirectsTo({ [`${REDIRECT}AXiHM1`]: 'https://es.wikipedia.org/wiki/colorimetria' }));

    const results = await searchWeb({ query: 'colorimetría' });

    expect(results.map((r) => r.url)).toEqual(['https://es.wikipedia.org/wiki/colorimetria']);
  });

  it('hands the reader the same normalised address the reader would produce itself', async () => {
    // `new URL(...).href` percent-encodes a non-ASCII path. That is not a
    // regression to fix here: `fetchDocumentationUrl` already normalises through
    // `new URL(...).href` and stores THAT as the source URL, so encoding here
    // keeps one spelling of a page across the search cache, the fetch cache and
    // the Sources panel. Two spellings would fetch, store and bill it twice.
    generateText.mockResolvedValue(grounded([{ uri: `${REDIRECT}acento` }]));
    vi.stubGlobal('fetch', redirectsTo({ [`${REDIRECT}acento`]: 'https://es.wikipedia.org/wiki/Colorimetría' }));

    const [result] = await searchWeb({ query: 'colorimetría' });

    expect(result?.url).toBe('https://es.wikipedia.org/wiki/Colorimetr%C3%ADa');
    expect(result?.url).toBe(new URL('https://es.wikipedia.org/wiki/Colorimetría').href);
  });

  it('drops a citation it cannot resolve rather than saving a link that will expire', async () => {
    generateText.mockResolvedValue(grounded([{ uri: `${REDIRECT}dead` }, { uri: `${REDIRECT}alive` }]));
    vi.stubGlobal(
      'fetch',
      redirectsTo({ [`${REDIRECT}dead`]: null, [`${REDIRECT}alive`]: 'https://ejemplo.com/guia' })
    );

    const results = await searchWeb({ query: 'colorimetría' });

    expect(results.map((r) => r.url)).toEqual(['https://ejemplo.com/guia']);
  });

  it('guards the address underneath, not the Google host every citation wears', async () => {
    // The SSRF guard used to run on the URL search returned. Under grounding that
    // URL is always vertexaisearch.cloud.google.com, so a guard placed before the
    // hop would wave everything through.
    generateText.mockResolvedValue(
      grounded([{ uri: `${REDIRECT}meta` }, { uri: `${REDIRECT}local` }, { uri: `${REDIRECT}real` }])
    );
    vi.stubGlobal(
      'fetch',
      redirectsTo({
        [`${REDIRECT}meta`]: 'http://169.254.169.254/latest/meta-data',
        [`${REDIRECT}local`]: 'http://localhost:3000/admin',
        [`${REDIRECT}real`]: 'https://ejemplo.com/real'
      })
    );

    const results = await searchWeb({ query: 'anything' });

    expect(results.map((r) => r.url)).toEqual(['https://ejemplo.com/real']);
  });

  it('drops the platforms that answer with a login wall or a video player', async () => {
    // Measured on the first real run: both Facebook posts and the Instagram reel
    // came back as "Log in / Sign Up", and the YouTube page as comment counts.
    // Four of nine pages, all of them heading for the source pack.
    generateText.mockResolvedValue(
      grounded([{ uri: `${REDIRECT}fb` }, { uri: `${REDIRECT}yt` }, { uri: `${REDIRECT}wiki` }])
    );
    vi.stubGlobal(
      'fetch',
      redirectsTo({
        [`${REDIRECT}fb`]: 'https://www.facebook.com/groups/x/posts/1',
        [`${REDIRECT}yt`]: 'https://www.youtube.com/watch?v=abc',
        [`${REDIRECT}wiki`]: 'https://es.wikipedia.org/wiki/colorimetria'
      })
    );

    const results = await searchWeb({ query: 'colorimetría' });

    expect(results.map((r) => r.url)).toEqual(['https://es.wikipedia.org/wiki/colorimetria']);
  });

  it('counts a page once however many times the answer cited it', async () => {
    generateText.mockResolvedValue(grounded([{ uri: `${REDIRECT}a` }, { uri: `${REDIRECT}b` }]));
    vi.stubGlobal(
      'fetch',
      redirectsTo({
        [`${REDIRECT}a`]: 'https://ejemplo.com/guia',
        [`${REDIRECT}b`]: 'https://ejemplo.com/guia?utm_source=gemini'
      })
    );

    const results = await searchWeb({ query: 'colorimetría' });

    expect(results).toHaveLength(1);
  });

  it('uses what the page contributed as its snippet, since grounding has no snippet field', async () => {
    generateText.mockResolvedValue(
      grounded([{ uri: `${REDIRECT}a` }], {
        groundingSupports: [
          { segment: { text: 'El sistema NCS codifica el matiz.' }, groundingChunkIndices: [0] },
          { segment: { text: 'RAL 9010 es el blanco de referencia.' }, groundingChunkIndices: [0] }
        ]
      })
    );
    vi.stubGlobal('fetch', redirectsTo({ [`${REDIRECT}a`]: 'https://ejemplo.com/ncs' }));

    const [result] = await searchWeb({ query: 'colorimetría' });

    expect(result?.snippet).toBe('El sistema NCS codifica el matiz. RAL 9010 es el blanco de referencia.');
  });
});

describe('groundedSearch', () => {
  it('reports the searches Gemini actually ran, not the ones we guessed for it', async () => {
    // The teacher sees these on the wizard. Writing the queries ourselves was the
    // separate model call this change removed, so they can only come from the
    // provider now.
    generateText.mockResolvedValue(
      grounded([{ uri: `${REDIRECT}a` }], { webSearchQueries: ['colorimetría NCS', 'norma RAL pinturas'] })
    );
    vi.stubGlobal('fetch', redirectsTo({ [`${REDIRECT}a`]: 'https://ejemplo.com/ncs' }));

    const outcome = await groundedSearch({ instruction: 'buscá', prompt: 'colorimetría' });

    expect(outcome.queries).toEqual(['colorimetría NCS', 'norma RAL pinturas']);
  });

  it('reports a failing search service rather than returning nothing', async () => {
    generateText.mockRejectedValue(new Error('503 model overloaded'));

    await expect(groundedSearch({ instruction: 'buscá', prompt: 'anything' })).rejects.toThrow(
      /Failed to reach the search service/
    );
  });

  it('returns nothing to build on when the answer cited nothing', async () => {
    generateText.mockResolvedValue({ providerMetadata: undefined });

    const outcome = await groundedSearch({ instruction: 'buscá', prompt: 'anything' });

    expect(outcome).toEqual({ queries: [], results: [] });
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

  it('takes the best of every search before the long tail of any one of them', () => {
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
