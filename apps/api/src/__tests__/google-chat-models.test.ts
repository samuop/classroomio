/**
 * The panel's model list is Google's answer, not a constant — so what gets
 * filtered out of that answer is the whole contract.
 *
 * Google's listing mixes chat models with embeddings, image and speech models,
 * and specialist previews (robotics reasoning, computer use). Every one of those
 * advertises `generateContent`, so "supports generateContent" is not enough: an
 * operator who picked one would get a dropdown entry that fails on every agent
 * call, and nothing in the panel would explain why.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { invalidateGoogleModelCache, listGoogleChatModelIds } from '@api/services/platform/google-models';

function googleResponse(names: string[], methods = ['generateContent']) {
  return {
    ok: true,
    json: async () => ({
      models: names.map((name) => ({ name: `models/${name}`, supportedGenerationMethods: methods }))
    })
  } as Response;
}

const originalKey = process.env.GOOGLE_API_KEY;

beforeEach(() => {
  process.env.GOOGLE_API_KEY = 'test-key';
  invalidateGoogleModelCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
  invalidateGoogleModelCache();

  if (originalKey === undefined) delete process.env.GOOGLE_API_KEY;
  else process.env.GOOGLE_API_KEY = originalKey;
});

describe('listGoogleChatModelIds', () => {
  it('keeps chat models and strips the models/ prefix the SDK does not take', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => googleResponse(['gemini-3.5-flash', 'gemini-2.5-flash-lite'])));

    expect(await listGoogleChatModelIds()).toEqual(['gemini-3.5-flash', 'gemini-2.5-flash-lite']);
  });

  it('drops everything that is not a chat model, however it answers generateContent', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        googleResponse([
          'gemini-3.5-flash',
          'gemini-embedding-001',
          'gemini-3.1-flash-image',
          'gemini-2.5-flash-preview-tts',
          'gemini-live-2.5-flash',
          'gemini-robotics-er-2-preview',
          'gemini-2.5-computer-use-preview-10-2025',
          'imagen-4.0-generate-001',
          'veo-3.0-generate-001'
        ])
      )
    );

    expect(await listGoogleChatModelIds()).toEqual(['gemini-3.5-flash']);
  });

  it('ignores a model that cannot generate content at all', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => googleResponse(['gemini-3.5-flash'], ['embedContent'])));

    expect(await listGoogleChatModelIds()).toEqual([]);
  });

  it('sorts newest first, with the unversioned aliases leading', async () => {
    // Alphabetical would put 2.5 above 3.7 and bury the model the operator came
    // looking for under years of older ones.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        googleResponse(['gemini-2.5-flash', 'gemini-3.7-flash', 'gemini-flash-latest', 'gemini-3.1-flash-lite'])
      )
    );

    expect(await listGoogleChatModelIds()).toEqual([
      'gemini-flash-latest',
      'gemini-3.7-flash',
      'gemini-3.1-flash-lite',
      'gemini-2.5-flash'
    ]);
  });

  it('answers null — not an empty list — when Google refuses', async () => {
    // The caller falls back to its shortlist on null. An empty array would mean
    // "this key can call nothing", and would empty the operator's dropdown.
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 403, text: async () => 'denied' }) as Response));

    expect(await listGoogleChatModelIds()).toBeNull();
  });

  it('answers null when the request throws, rather than propagating into the panel', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      })
    );

    expect(await listGoogleChatModelIds()).toBeNull();
  });

  it('answers null with no key configured, without calling out', async () => {
    delete process.env.GOOGLE_API_KEY;
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    expect(await listGoogleChatModelIds()).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('caches, so the panel does not call Google on every page load', async () => {
    const fetchSpy = vi.fn(async () => googleResponse(['gemini-3.5-flash']));
    vi.stubGlobal('fetch', fetchSpy);

    await listGoogleChatModelIds();
    await listGoogleChatModelIds();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
