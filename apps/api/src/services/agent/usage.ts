import type { TokenBalance, TokenUsage } from '@cio/ai-assistant';
import {
  aggregateTokenUsageByUser,
  countRequests,
  getDailyTokenUsageHistory,
  getMonthlyTokenUsage,
  getOrgCreditBalance,
  insertTokenUsageAndDrainCredits,
  summarizePurchases,
  upsertCreditBalance
} from '@cio/db/queries/agent';
import type { UsageLeaderboardRow } from '@cio/db/queries/agent';
import { getActiveOrganizationPlan } from '@cio/db/queries/organization';

import { AppError } from '@api/utils/errors';
import { env } from '@api/config/env';

/**
 * Self-hosted instances bring their own provider API key and pay the provider
 * directly, so the plan-based token allowance must NOT block them. We still
 * record usage (for stats), we just never enforce a cap.
 */
const isSelfHosted = (): boolean => env.PUBLIC_IS_SELFHOSTED === 'true';

function startOfCurrentMonth(): Date {
  const date = new Date();
  date.setDate(1);
  date.setHours(0, 0, 0, 0);

  return date;
}

// ─── Plan-Based Token Allowances ─────────────────────────────────────────────

const PLAN_TOKEN_ALLOWANCES: Record<string, number> = {
  BASIC: 500_000,
  EARLY_ADOPTER: 3_000_000,
  ENTERPRISE: 15_000_000
};

// ─── Model Cost Multipliers ───────────────────────────────────────────────────

// Blended multiplier vs Gemini 3.1 Flash Lite baseline ($0.50/1M blended at 80/20 input/output mix); unknown → 1×.
// gemini-2.5-flash kept for backward compat with historical usage records.
const MODEL_COST_MULTIPLIER: Record<string, number> = {
  'gemini-3.1-flash-lite': 1,
  'gemini-flash-lite-latest': 1, // Google alias → newest stable Flash-Lite (baseline cost)
  'gemini-flash-latest': 1.5, // Google alias → newest stable Flash (a bit pricier than Lite)
  'gemini-2.5-flash-lite': 1,
  'gemini-2.5-flash': 1.5,
  'gpt-5.4-mini': 4,
  'claude-sonnet-4-6': 11,
  'claude-haiku-4-5-20251001': 1.5,
  'kimi-k2.6': 4
};

/**
 * What a model's tokens are billed at, and whether that number was measured.
 *
 * Exported because the platform panel now offers whatever models Google reports,
 * not a hand-kept list. A model nobody priced still has to be counted at
 * something, and 1× is that something — but the panel says so out loud instead
 * of presenting a guess as a fact, which is the whole difference between an
 * under-reported cap and an informed choice.
 */
const modelosSinPrecioAvisados = new Set<string>();

export function getModelCostMultiplier(model: string): { multiplier: number; isMeasured: boolean } {
  const known = MODEL_COST_MULTIPLIER[model];

  if (known === undefined) {
    // Una vez por modelo y por proceso: el 1× de un modelo sin precio es una
    // suposición, y hasta ahora era una suposición MUDA — nadie se enteraba de
    // que el cupo se estaba descontando con un número inventado. El Set evita
    // que esto inunde el log en una tanda de 40 pasos.
    if (!modelosSinPrecioAvisados.has(model)) {
      modelosSinPrecioAvisados.add(model);
      console.warn(`[usage] modelo sin precio medido: "${model}" — se cobra a 1×. Agregalo a MODEL_COST_MULTIPLIER.`);
    }

    return { multiplier: 1, isMeasured: false };
  }

  return { multiplier: known, isMeasured: true };
}

// ─── Cache Read Discounts ─────────────────────────────────────────────

/**
 * What a cached input token costs, as a fraction of a fresh one.
 *
 * Every provider re-reads the cached prefix on every step and bills it — but at
 * a fraction. Anthropic charges 0.1× for a cache read; Google's context caching
 * is a 75% discount, so 0.25×.
 *
 * Per provider and not a single constant because getting it wrong in the cheap
 * direction under-charges silently, which is the failure nobody notices until
 * the provider bill arrives.
 */
const CACHE_READ_FACTOR: Record<string, number> = {
  anthropic: 0.1,
  google: 0.25,
  openai: 0.5, // OpenAI's cached input is half price.
  moonshot: 0.1,
  minimax: 1 // Unpriced: charged in full rather than guessed in our favour.
};

/**
 * Unknown providers pay full price — never guess a discount we cannot name.
 *
 * El `?? 1` solo no alcanzaba: con `provider === ''` el `&&` devuelve `''`, que
 * `??` deja pasar y que en una multiplicación vale 0 — la caché salía GRATIS.
 * Lo agarró el typecheck (`number | ''`), no un test.
 */
export function getCacheReadFactor(provider: string | undefined): number {
  const factor = provider ? CACHE_READ_FACTOR[provider] : undefined;

  return factor ?? 1;
}

/**
 * What this call costs the plan, in credit units.
 *
 * **`promptTokens` INCLUDES the cached re-reads** (the provider reports cache
 * reads as a subset of input — see the `ai_token_usage` schema). Charging it
 * whole was billing a cached re-read at the price of fresh input.
 *
 * Measured in production 2026-08-26: **64.5% of all input that month came from
 * cache** (11.2M of 17.4M). The month was charged 17.7M units where the weighted
 * figure is ~7.6-9.3M — the counter was inflating by roughly 2×, and the org
 * hit its cap on a bill it never incurred.
 *
 * Deliberately NOT retroactive: historical rows keep the units they were
 * charged. Recomputing them would rewrite numbers people already saw.
 */
export function computeCostUnits(usage: TokenUsage, model: string, provider?: string): number {
  const cacheRead = Math.min(usage.cacheReadTokens ?? 0, usage.promptTokens);
  const freshInput = usage.promptTokens - cacheRead;
  const weightedInput = freshInput + cacheRead * getCacheReadFactor(provider);

  return Math.round((weightedInput + usage.completionTokens) * getModelCostMultiplier(model).multiplier);
}

async function getPlanAllowance(orgId: string): Promise<{ planName: string; allowance: number }> {
  const activePlan = await getActiveOrganizationPlan(orgId);

  if (!activePlan || !activePlan.planName) {
    return { planName: 'BASIC', allowance: PLAN_TOKEN_ALLOWANCES.BASIC };
  }

  const planName = activePlan.planName;
  const payload = activePlan.payload as Record<string, unknown> | null;
  const customAllowance = payload?.aiTokenAllowance as number | undefined;
  const allowance = customAllowance ?? PLAN_TOKEN_ALLOWANCES[planName] ?? 0;

  return { planName, allowance };
}

export async function getMonthlyUsage(orgId: string): Promise<number> {
  return getMonthlyTokenUsage(orgId, startOfCurrentMonth());
}

export async function getCreditBalance(orgId: string): Promise<number> {
  return getOrgCreditBalance(orgId);
}

export async function getTokenBalance(orgId: string): Promise<TokenBalance> {
  const [{ allowance }, monthlyUsage, creditBalance] = await Promise.all([
    getPlanAllowance(orgId),
    getMonthlyUsage(orgId),
    getCreditBalance(orgId)
  ]);

  const remainingAllowance = Math.max(0, allowance - monthlyUsage);
  const remaining = remainingAllowance + creditBalance;

  return {
    used: monthlyUsage,
    allowance,
    creditBalance,
    remaining
  };
}

export async function enforceTokenBalance(orgId: string): Promise<TokenBalance> {
  const balance = await getTokenBalance(orgId);

  // Self-hosted instances use their own provider key — never cap them.
  if (isSelfHosted()) {
    return balance;
  }

  if (balance.remaining <= 0) {
    throw new AppError('Token limit reached', 'TOKEN_LIMIT_REACHED', 402);
  }

  return balance;
}

export function computePurchasedTokenOverflow(params: {
  allowance: number;
  monthlyUsageBefore: number;
  requestTokens: number;
}): number {
  const allowanceRemainingBefore = Math.max(0, params.allowance - params.monthlyUsageBefore);

  return Math.max(0, params.requestTokens - allowanceRemainingBefore);
}

/** Record token usage after an LLM call; drains purchased credits when usage exceeds plan allowance. */
export async function recordTokenUsage(
  orgId: string,
  userId: string,
  courseId: string,
  usage: TokenUsage,
  model: string,
  provider?: string
): Promise<void> {
  const costUnits = computeCostUnits(usage, model, provider);
  const { allowance } = await getPlanAllowance(orgId);

  await insertTokenUsageAndDrainCredits({
    orgId,
    userId,
    courseId,
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    totalTokens: usage.totalTokens ?? null,
    reasoningTokens: usage.reasoningTokens ?? null,
    cacheReadTokens: usage.cacheReadTokens ?? null,
    cacheWriteTokens: usage.cacheWriteTokens ?? null,
    costUnits,
    model,
    planAllowance: allowance,
    since: startOfCurrentMonth()
  });
}

export async function getOrgPlanName(orgId: string): Promise<string> {
  const { planName } = await getPlanAllowance(orgId);

  return planName;
}

export async function isOrgOnPaidPlan(orgId: string): Promise<boolean> {
  // Self-hosted instances bring their own provider key — every plan-gated AI
  // feature (document upload, URL fetching, premium question types) is unlocked.
  if (isSelfHosted()) {
    return true;
  }

  const planName = await getOrgPlanName(orgId);

  return planName !== 'BASIC';
}

// ─── Usage History ───────────────────────────────────────────────────────────

export interface DailyUsage {
  date: string;
  tokens: number;
}

export async function getUsageHistory(orgId: string): Promise<DailyUsage[]> {
  return getDailyTokenUsageHistory(orgId, startOfCurrentMonth());
}

export interface PurchasedSummary {
  totalPurchasedTokens: number;
  totalSpentCents: number;
  currency: 'USD';
  currentBalance: number;
  lastPurchaseAt: string | null;
}

export async function getPurchasedSummary(orgId: string): Promise<PurchasedSummary> {
  const [summary, currentBalance] = await Promise.all([summarizePurchases(orgId), getCreditBalance(orgId)]);

  return {
    totalPurchasedTokens: summary.totalPurchasedTokens,
    totalSpentCents: summary.totalSpentCents,
    currency: 'USD',
    currentBalance,
    lastPurchaseAt: summary.lastPurchaseAt
  };
}

export interface LeaderboardEntry {
  userId: string;
  fullname: string | null;
  email: string | null;
  avatarUrl: string | null;
  tokens: number;
  requests: number;
  percentage: number;
}

export async function getTeamLeaderboard(orgId: string): Promise<{ entries: LeaderboardEntry[]; totalTokens: number }> {
  const rows: UsageLeaderboardRow[] = await aggregateTokenUsageByUser(orgId, startOfCurrentMonth());
  const totalTokens = rows.reduce((sum: number, row: UsageLeaderboardRow) => sum + row.tokens, 0);

  const entries: LeaderboardEntry[] = rows.map((row: UsageLeaderboardRow) => ({
    userId: row.userId,
    fullname: row.fullname,
    email: row.email,
    avatarUrl: row.avatarUrl,
    tokens: row.tokens,
    requests: row.requests,
    percentage: totalTokens > 0 ? row.tokens / totalTokens : 0
  }));

  return { entries, totalTokens };
}

export async function getDetailedUsage(orgId: string) {
  const start = startOfCurrentMonth();
  const [balance, history, requestsThisMonth] = await Promise.all([
    getTokenBalance(orgId),
    getDailyTokenUsageHistory(orgId, start),
    countRequests(orgId, start)
  ]);

  return { ...balance, history, requestsThisMonth };
}

// ─── Credit Purchases ────────────────────────────────────────────────────────

export async function addCredits(orgId: string, amount: number): Promise<number> {
  if (amount <= 0) {
    throw new AppError('Credit amount must be positive', 'INVALID_CREDIT_AMOUNT', 400);
  }

  return upsertCreditBalance(orgId, amount);
}
