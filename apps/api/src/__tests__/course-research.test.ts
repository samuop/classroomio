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

const groundedSearch = vi.fn();
const fetchDocumentationUrl = vi.fn();
const storeDraftDocument = vi.fn();
const storeUrlDocument = vi.fn();
const lugarParaFuentes = vi.fn();

vi.mock('@api/services/agent/web-search', async () => {
  const actual = await vi.importActual<typeof import('@api/services/agent/web-search')>(
    '@api/services/agent/web-search'
  );

  return { ...actual, groundedSearch: (...args: unknown[]) => groundedSearch(...args) };
});

vi.mock('@api/services/agent/fetch-url', () => ({
  fetchDocumentationUrl: (...args: unknown[]) => fetchDocumentationUrl(...args)
}));

vi.mock('@api/services/agent/document', () => ({
  URL_SOURCE_MIME_TYPE: 'text/markdown',
  storeDraftDocument: (...args: unknown[]) => storeDraftDocument(...args),
  storeUrlDocument: (...args: unknown[]) => storeUrlDocument(...args),
  // El tope de fuentes del curso: lugar de sobra salvo que el test diga otra cosa.
  lugarParaFuentes: (...args: unknown[]) => lugarParaFuentes(...args),
  errorDeTopeDeFuentes: () => Object.assign(new Error('This course already has 100 sources'), { code: 'SOURCE_LIMIT_REACHED', statusCode: 422 }),
  esTopeDeFuentes: (error: unknown) => (error as { code?: string } | null)?.code === 'SOURCE_LIMIT_REACHED'
}));

vi.mock('@api/config/env', () => ({ env: { JINA_API_KEY: 'key' } }));

vi.mock('@api/utils/redis/redis', () => ({
  redis: { isOpen: false, get: vi.fn(), set: vi.fn() },
  logRedisUnavailableOnce: vi.fn()
}));

const { runResearch, searchAngle, isUnreadablePage, readableProseLength, buildBriefPrompt } = await import(
  '@api/services/agent/research'
);

const REDIS = {} as never;

const BASE = {
  orgId: 'org-1',
  userId: 'teacher-1',
  redis: REDIS
};

function page(url: string, content = 'x'.repeat(1000)) {
  return { url, pageTitle: `Título de ${url}`, content, links: [], contentTokens: 10, fetchedAt: '', cacheHit: false };
}

function found(results: { url: string; title?: string }[], queries: string[] = ['una búsqueda']) {
  return {
    queries,
    results: results.map((result) => ({ url: result.url, title: result.title ?? result.url, snippet: '' }))
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  lugarParaFuentes.mockResolvedValue(100);
  groundedSearch.mockResolvedValue(found([]));
  storeDraftDocument.mockImplementation(async () => ({ documentId: `doc-${storeDraftDocument.mock.calls.length}` }));
  storeUrlDocument.mockImplementation(async () => ({ documentId: `src-${storeUrlDocument.mock.calls.length}` }));
});

describe('isUnreadablePage', () => {
  it('rejects a page the reader could not actually open', () => {
    // Jina answers 200 and puts the real outcome in the body, so a 401 video page
    // was stored as a "source" made of comment counts.
    const youtube = [
      'Title: Cómo usar el catálogo de colores',
      'Warning: Target URL returned error 401: Unauthorized',
      'Markdown Content:',
      '## Comments 26',
      '## Description',
      'x'.repeat(5000)
    ].join('\n');

    expect(isUnreadablePage(youtube)).toBe(true);
  });

  it('rejects a login wall even though it is a big page', () => {
    // The Instagram reel was 22 KB — larger than three of the good sources — and
    // almost all of it links. Length cannot tell them apart; prose can.
    const wall = Array.from(
      { length: 300 },
      (_, i) => `[Log in](https://www.instagram.com/accounts/login/?next=%2Freel%2F${i})`
    ).join('\n');

    expect(readableProseLength(wall)).toBeLessThan(400);
    expect(isUnreadablePage(wall)).toBe(true);
  });

  it('keeps an article', () => {
    const article = [
      'Title: Fundamentos del color',
      'Markdown Content:',
      'El espacio CIELAB describe el color en tres ejes. '.repeat(40),
      '[Más información](https://www.datacolor.com/blog)'
    ].join('\n');

    expect(isUnreadablePage(article)).toBe(false);
  });
});

describe('buildBriefPrompt', () => {
  it('tells the searcher who the course is for, which is most of what decides a good page', () => {
    // Same words, different learners, different material: colour charts and how
    // to advise a customer, versus spectrophotometry and standards. The search
    // used to get the topic alone and could not tell those apart.
    const prompt = buildBriefPrompt('colorimetría de pinturas de paredes', {
      audience: 'vendedores de pinturería sin formación previa',
      level: 'intro'
    });

    expect(prompt).toContain('vendedores de pinturería');
    expect(prompt).toMatch(/introductory/i);
  });

  it('works with nothing but a topic, for a targeted top-up from the Sources panel', () => {
    expect(buildBriefPrompt('cartas RAL', {})).toContain('cartas RAL');
  });
});

describe('searchAngle', () => {
  it('asks for a cited survey, because the citations are the only output kept', async () => {
    // Grounding cites what it needed to write its answer. Asking for a list of
    // links returns two; asking for a survey with a source per point returns a
    // dozen — the instruction is what decides how much material comes back.
    await searchAngle('colorimetría', 'the references: standards and tables', {}, 10);

    const [call] = groundedSearch.mock.calls as unknown as [{ instruction: string; prompt: string; limit: number }][];

    expect(call[0].instruction).toMatch(/cite every one of them/i);
    expect(call[0].instruction).toContain('the references: standards and tables');
    expect(call[0].prompt).toContain('colorimetría');
  });
});

describe('runResearch', () => {
  it('saves every readable page as a draft source', async () => {
    groundedSearch.mockResolvedValue(found([{ url: 'https://a.com/1' }, { url: 'https://b.com/1' }]));
    fetchDocumentationUrl.mockImplementation(async ({ url }: { url: string }) => page(url));

    const outcome = await runResearch({ ...BASE, topic: 'colorimetría', depth: 'quick' });

    expect(outcome.sources).toHaveLength(2);
    expect(outcome.failedCount).toBe(0);
    expect(storeDraftDocument).toHaveBeenCalledTimes(2);
  });

  it('covers one angle of the subject per search, and more of them the deeper the run', async () => {
    // A single search returns paint-shop catalogues; the theory, the practice and
    // the standards are three different sets of pages. Depth buys angles, and a
    // deep run needs the extra ones to reach twenty readable pages.
    await runResearch({ ...BASE, topic: 'colorimetría', depth: 'quick' });
    expect(groundedSearch).toHaveBeenCalledTimes(2);

    groundedSearch.mockClear();
    await runResearch({ ...BASE, topic: 'colorimetría', depth: 'deep' });
    expect(groundedSearch).toHaveBeenCalledTimes(4);

    const angles = (groundedSearch.mock.calls as unknown as [{ instruction: string }][]).map(
      (call) => call[0].instruction
    );

    expect(new Set(angles).size).toBe(4);
  });

  it('reports the searches Gemini ran, not our guess at what it would search for', async () => {
    // Writing the queries ourselves was a separate model call, and this change
    // removed it: they can only come back from the provider now. Deduplicated,
    // because two angles routinely land on the same phrasing.
    groundedSearch
      .mockResolvedValueOnce(found([{ url: 'https://a.com/1' }], ['colorimetría NCS', 'espacio CIELAB']))
      .mockResolvedValueOnce(found([{ url: 'https://b.com/1' }], ['colorimetría NCS', 'norma RAL pinturas']));
    fetchDocumentationUrl.mockImplementation(async ({ url }: { url: string }) => page(url));

    const outcome = await runResearch({ ...BASE, topic: 'colorimetría', depth: 'quick' });

    expect(outcome.queries).toEqual(['colorimetría NCS', 'espacio CIELAB', 'norma RAL pinturas']);
  });

  it('spends one clock on searching and reading, not one clock each', async () => {
    // Jina answered a search in about a second, so a reading-only deadline was
    // close enough. A grounded call is the model running several searches and
    // writing a survey — 13s measured — and stacked on top of a 45s read budget
    // that put a deep run past what the other end was willing to wait (then
    // Nginx; measured later, the browser at 30s). A timeout nobody would have
    // read as a clock problem.
    let clock = Date.now();
    const now = vi.spyOn(Date, 'now').mockImplementation(() => clock);

    groundedSearch.mockImplementation(async () => {
      clock += 50_000;

      return found([{ url: 'https://a.com/1' }]);
    });
    fetchDocumentationUrl.mockImplementation(async ({ url }: { url: string }) => page(url));

    const outcome = await runResearch({ ...BASE, topic: 'colorimetría', depth: 'quick' });

    expect(fetchDocumentationUrl).not.toHaveBeenCalled();
    expect(outcome.sources).toEqual([]);

    now.mockRestore();
  });

  it('loses one page, not the research, when a fetch fails', async () => {
    groundedSearch.mockResolvedValue(found([{ url: 'https://good.com/1' }, { url: 'https://dead.com/1' }]));
    fetchDocumentationUrl.mockImplementation(async ({ url }: { url: string }) => {
      if (url.includes('dead')) throw new Error('502');

      return page(url);
    });

    const outcome = await runResearch({ ...BASE, topic: 'colorimetría', depth: 'quick' });

    expect(outcome.sources.map((s) => s.url)).toEqual(['https://good.com/1']);
    expect(outcome.failedCount).toBe(1);
  });

  it('keeps going when one of the searches fails', async () => {
    groundedSearch
      .mockRejectedValueOnce(new Error('rate limited'))
      .mockResolvedValueOnce(found([{ url: 'https://b.com/1' }]));
    fetchDocumentationUrl.mockImplementation(async ({ url }: { url: string }) => page(url));

    const outcome = await runResearch({ ...BASE, topic: 'colorimetría', depth: 'quick' });

    expect(outcome.sources).toHaveLength(1);
  });

  it('discards a page with nothing on it rather than storing an empty source', async () => {
    groundedSearch.mockResolvedValue(found([{ url: 'https://thin.com/1' }]));
    fetchDocumentationUrl.mockResolvedValue(page('https://thin.com/1', 'demasiado corto'));

    const outcome = await runResearch({ ...BASE, topic: 'colorimetría', depth: 'quick' });

    expect(outcome.sources).toHaveLength(0);
    expect(outcome.failedCount).toBe(1);
    expect(storeDraftDocument).not.toHaveBeenCalled();
  });

  it('never reads more pages than the chosen depth allows', async () => {
    groundedSearch.mockResolvedValue(found(Array.from({ length: 20 }, (_, i) => ({ url: `https://a.com/${i}` }))));
    fetchDocumentationUrl.mockImplementation(async ({ url }: { url: string }) => page(url));

    const outcome = await runResearch({ ...BASE, topic: 'colorimetría', depth: 'quick' });

    expect(outcome.sources).toHaveLength(5);
    expect(fetchDocumentationUrl).toHaveBeenCalledTimes(5);
  });

  it('writes straight into the Sources tab when the course already exists', async () => {
    // A draft would leave the tab empty until the teacher happens to send a chat
    // message, and expire an hour later if they do not.
    groundedSearch.mockResolvedValue(found([{ url: 'https://a.com/1' }]));
    fetchDocumentationUrl.mockImplementation(async ({ url }: { url: string }) => page(url));

    const outcome = await runResearch({
      ...BASE,
      topic: 'colorimetría',
      depth: 'quick',
      courseId: 'course-1',
      conversationId: 'conv-1'
    });

    expect(storeUrlDocument).toHaveBeenCalledTimes(1);
    expect(storeDraftDocument).not.toHaveBeenCalled();
    expect(outcome.sources[0].documentId).toBe('src-1');
  });

  it('falls back to drafts when the wizard researches before the course exists', async () => {
    groundedSearch.mockResolvedValue(found([{ url: 'https://a.com/1' }]));
    fetchDocumentationUrl.mockImplementation(async ({ url }: { url: string }) => page(url));

    await runResearch({ ...BASE, topic: 'colorimetría', depth: 'quick' });

    expect(storeDraftDocument).toHaveBeenCalledTimes(1);
    expect(storeUrlDocument).not.toHaveBeenCalled();
  });

  describe('el tope de fuentes del curso', () => {
    const EN_EL_CURSO = { courseId: 'course-1', conversationId: 'conv-1' };

    it('con el curso lleno no busca nada: 422 SOURCE_LIMIT_REACHED', async () => {
      lugarParaFuentes.mockResolvedValue(0);

      await expect(runResearch({ ...BASE, ...EN_EL_CURSO, topic: 'colorimetría', depth: 'normal' })).rejects.toMatchObject({
        code: 'SOURCE_LIMIT_REACHED',
        statusCode: 422
      });
      expect(groundedSearch).not.toHaveBeenCalled();
    });

    it('con poco lugar lee sólo las que entran, y dice cuántas quedaron afuera', async () => {
      lugarParaFuentes.mockResolvedValue(3);
      groundedSearch.mockResolvedValue(found(Array.from({ length: 20 }, (_, i) => ({ url: `https://a.com/${i}` }))));
      fetchDocumentationUrl.mockImplementation(async ({ url }: { url: string }) => page(url));

      const outcome = await runResearch({ ...BASE, ...EN_EL_CURSO, topic: 'colorimetría', depth: 'normal' });

      expect(outcome.sources).toHaveLength(3);
      expect(storeUrlDocument).toHaveBeenCalledTimes(3);
      expect(outcome.leftOutByLimit).toBe(7);
    });

    it('si el curso se llena mientras lee, deja de leer y cuenta la que no entró como afuera, no como fallida', async () => {
      groundedSearch.mockResolvedValue(found(Array.from({ length: 20 }, (_, i) => ({ url: `https://a.com/${i}` }))));
      fetchDocumentationUrl.mockImplementation(async ({ url }: { url: string }) => page(url));
      storeUrlDocument.mockImplementation(async () => {
        if (storeUrlDocument.mock.calls.length > 2) {
          throw Object.assign(new Error('This course already has 100 sources'), { code: 'SOURCE_LIMIT_REACHED' });
        }

        return { documentId: `src-${storeUrlDocument.mock.calls.length}` };
      });

      const outcome = await runResearch({ ...BASE, ...EN_EL_CURSO, topic: 'colorimetría', depth: 'quick' });

      expect(outcome.sources).toHaveLength(2);
      expect(outcome.leftOutByLimit).toBeGreaterThanOrEqual(1);
      expect(outcome.failedCount).toBe(0);
    });

    it('sin curso (el asistente de creación) no hay tope que mirar', async () => {
      groundedSearch.mockResolvedValue(found([{ url: 'https://a.com/1' }]));
      fetchDocumentationUrl.mockImplementation(async ({ url }: { url: string }) => page(url));

      const outcome = await runResearch({ ...BASE, topic: 'colorimetría', depth: 'quick' });

      expect(lugarParaFuentes).not.toHaveBeenCalled();
      expect(outcome.leftOutByLimit).toBe(0);
    });
  });

  it('returns nothing to build on when the searches come back empty', async () => {
    groundedSearch.mockResolvedValue(found([]));

    const outcome = await runResearch({ ...BASE, topic: 'colorimetría', depth: 'normal' });

    expect(outcome.sources).toEqual([]);
    expect(fetchDocumentationUrl).not.toHaveBeenCalled();
  });
});
