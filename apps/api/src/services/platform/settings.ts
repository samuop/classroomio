/**
 * Deployment settings the platform owner edits from the panel instead of from
 * the `.env` and a restart.
 *
 * Only the chat MODEL moves here. The API keys stay in the environment on
 * purpose — a model name is an operational choice, a key is a secret, and an
 * admin screen that can read one should not be able to read the other. The
 * provider switch (`CHAT_PROVIDER`) stays in the environment for the same
 * reason it always was: it decides which key is even consulted.
 */
import { AIProvider, pickAnyConfiguredProvider, type AIProviderConfig } from '@cio/ai-assistant';
import { getOrganizationModelOverride, getPlatformSettings } from '@cio/db/queries/platform';
import { getModelCostMultiplier } from '@api/services/agent/usage';
import { listGoogleChatModelIds } from '@api/services/platform/google-models';

export const PLATFORM_SETTING_KEYS = {
  chatModel: 'chat_model'
} as const;

/**
 * What the panel offers when Google cannot be asked — no key, no network, or an
 * unhappy endpoint. Not the catalogue: the last-known-good shortlist, so the
 * dropdown is never empty and the models already in use stay selectable.
 */
const FALLBACK_CHAT_MODEL_IDS = [
  'gemini-flash-lite-latest',
  'gemini-3.1-flash-lite',
  'gemini-flash-latest',
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash'
];

export interface SelectableChatModel {
  id: string;
  /** Cost units per token, against the Flash-Lite baseline. */
  multiplier: number;
  /**
   * False when nobody has priced this model and it is being counted at 1×. The
   * panel shows that, because an unpriced model silently under-reports usage
   * against the very caps the panel exists to set.
   */
  isMeasuredCost: boolean;
  /** True when the id came from Google rather than the fallback shortlist. */
  isLive: boolean;
}

/** Every model the panel may select right now, newest first. */
export async function listSelectableChatModels(): Promise<SelectableChatModel[]> {
  const live = await listGoogleChatModelIds();
  const ids = live && live.length > 0 ? live : FALLBACK_CHAT_MODEL_IDS;

  return ids.map((id) => {
    const { multiplier, isMeasured } = getModelCostMultiplier(id);

    return { id, multiplier, isMeasuredCost: isMeasured, isLive: live !== null && live.length > 0 };
  });
}

/**
 * Whether a model may be stored as the deployment's or an organisation's.
 *
 * Checked against the live listing rather than a constant so the panel and the
 * validator can never disagree — offering a model and then rejecting it on save
 * is the failure a curated list produces every time Google ships something.
 */
export async function isSelectableChatModel(value: string): Promise<boolean> {
  const models = await listSelectableChatModels();

  return models.some((model) => model.id === value);
}

/**
 * Settings are read on nearly every agent call, so they are cached — but with a
 * short TTL rather than forever.
 *
 * Clearing the cache on write only fixes the process that did the writing. A
 * second API instance (or a PM2 restart racing the save) would keep serving the
 * old model indefinitely, and "I changed it and nothing happened" is the worst
 * possible failure for a control panel. The TTL bounds that to seconds without
 * needing a pub/sub channel this deployment does not have.
 */
const CACHE_TTL_MS = 30_000;

let cache: { value: Record<string, Record<string, unknown>>; expiresAt: number } | null = null;

export async function getSettings(): Promise<Record<string, Record<string, unknown>>> {
  if (cache && cache.expiresAt > Date.now()) return cache.value;

  const value = await getPlatformSettings();
  cache = { value, expiresAt: Date.now() + CACHE_TTL_MS };

  return value;
}

/** Drops the cache so the next read reflects a write this process just made. */
export function invalidateSettingsCache(): void {
  cache = null;
}

/** The deployment-wide chat model, or null when none has been chosen. */
export async function getGlobalChatModel(): Promise<string | null> {
  const settings = await getSettings();
  const value = settings[PLATFORM_SETTING_KEYS.chatModel]?.model;

  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/**
 * Provider configuration for one organisation's agent run.
 *
 * Resolution order is org override → deployment setting → whatever
 * `pickAnyConfiguredProvider` already resolved from the environment. The
 * environment stays last rather than being removed: it is the escape hatch when
 * a stored model turns out to be wrong and the panel is the thing that is broken.
 *
 * The override is applied ONLY when the active provider is Google. These are
 * Gemini model names; handing one to MiniMax would not fall back, it would fail
 * every call — and the provider is chosen by an env var this panel does not set.
 */
export async function providerConfigForOrg(orgId: string): Promise<AIProviderConfig | null> {
  const base = pickAnyConfiguredProvider();

  if (!base || base.provider !== AIProvider.GOOGLE) return base;

  const [override, global] = await Promise.all([getOrganizationModelOverride(orgId), getGlobalChatModel()]);
  const model = override ?? global;

  return model ? { ...base, model } : base;
}
