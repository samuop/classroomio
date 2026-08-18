/**
 * The chat models this deployment may actually be pointed at, asked of Google
 * rather than kept in a list here.
 *
 * A hand-kept list has one failure mode that matters: Google ships a model, the
 * operator reads about it, and the panel does not offer it — so the panel is
 * wrong and there is no way to tell from inside it. `GET /v1beta/models` is the
 * authority on what the key can call, so that is what the panel shows.
 *
 * What stays local is the price. Google's listing carries no cost, and usage is
 * billed against each organisation's cap in multiples of the Flash-Lite baseline
 * (`getModelCostMultiplier`, services/agent/usage.ts). Models nobody has priced
 * are still offered, but flagged as estimated — see the note there.
 */
import { AIProvider, pickAnyConfiguredProvider } from '@cio/ai-assistant';

const GOOGLE_MODELS_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * Long, because this list changes when Google ships a model — a matter of weeks
 * — and the panel must not put a network call in front of every page load.
 */
const LIST_TTL_MS = 60 * 60 * 1000;

const REQUEST_TIMEOUT_MS = 8_000;

/**
 * Models that answer `generateContent` but have no business writing a course:
 * other modalities (image, speech), and the specialist previews Google ships
 * alongside them — robotics reasoning, computer use. Offering them would put a
 * model in the list that fails, or answers strangely, on every agent call.
 */
const NON_CHAT_MARKERS = [
  'embedding',
  'image',
  'tts',
  'audio',
  'live',
  'veo',
  'imagen',
  'aqa',
  'robotics',
  'computer-use'
];

interface GoogleModelEntry {
  name?: string;
  displayName?: string;
  supportedGenerationMethods?: string[];
}

let cache: { ids: string[]; expiresAt: number } | null = null;

/** The Google key, whether or not Google is the configured chat provider. */
function googleApiKey(): string | null {
  const configured = pickAnyConfiguredProvider();
  if (configured?.provider === AIProvider.GOOGLE && configured.apiKey) return configured.apiKey;

  const fromEnv = process.env.GOOGLE_API_KEY?.trim();

  return fromEnv ? fromEnv : null;
}

function isChatModelId(id: string): boolean {
  if (!id.startsWith('gemini-')) return false;

  return !NON_CHAT_MARKERS.some((marker) => id.includes(marker));
}

/**
 * Newest first, by the version number in the name.
 *
 * Alphabetical would put `gemini-2.5-…` above `gemini-3.1-…` and bury the model
 * the operator is most likely looking for under a decade of older ones. Aliases
 * (`gemini-flash-latest`) carry no version and lead the list — they are the ones
 * that stay correct without anybody editing anything.
 */
function byNewestFirst(a: string, b: string): number {
  const version = (id: string) => {
    const match = id.match(/gemini-(\d+)(?:\.(\d+))?/);

    return match ? Number(match[1]) * 100 + Number(match[2] ?? 0) : Number.POSITIVE_INFINITY;
  };

  const difference = version(b) - version(a);

  return difference !== 0 ? difference : a.localeCompare(b);
}

/**
 * Chat model ids the configured Google key can call, or null when the question
 * cannot be answered (no key, network down, Google unhappy).
 *
 * Null and an empty array mean different things and the caller acts on both:
 * null is "I don't know, use the fallback list", `[]` is "the key can call no
 * chat model at all", which is worth showing rather than papering over.
 */
export async function listGoogleChatModelIds(): Promise<string[] | null> {
  if (cache && cache.expiresAt > Date.now()) return cache.ids;

  const apiKey = googleApiKey();
  if (!apiKey) return null;

  try {
    const response = await fetch(`${GOOGLE_MODELS_URL}?pageSize=200&key=${encodeURIComponent(apiKey)}`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });

    if (!response.ok) {
      console.error('[platform] Google model listing failed:', response.status, await response.text().catch(() => ''));
      return null;
    }

    const body = (await response.json()) as { models?: GoogleModelEntry[] };

    const ids = (body.models ?? [])
      .filter((model) => model.supportedGenerationMethods?.includes('generateContent'))
      // `models/gemini-2.5-flash` → `gemini-2.5-flash`, which is what the SDK takes.
      .map((model) => (model.name ?? '').replace(/^models\//, ''))
      .filter(isChatModelId)
      .sort(byNewestFirst);

    cache = { ids, expiresAt: Date.now() + LIST_TTL_MS };

    return ids;
  } catch (error) {
    console.error('[platform] Google model listing failed:', error);
    return null;
  }
}

/** Drops the cached listing so the next read asks Google again. */
export function invalidateGoogleModelCache(): void {
  cache = null;
}
