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
 *
 * Desde que hay precio por modelo, esto ya NO decide la caché de un modelo con
 * precio de lista: esa va en su tarifa, con el número de Google (en 3.x es el
 * 10% de la entrada, no el 25%). Sigue valiendo para lo que no tiene precio de
 * lista: las equivalencias legadas, que tienen que dar exactamente lo mismo que
 * antes; un modelo desconocido que no sirve Google; y la caché de 2.5 Flash, que
 * se tomó con esta misma proporción por falta de dato.
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

// ─── Precio de cada modelo ────────────────────────────────────────────────────

/**
 * Lo que vale una unidad del cupo: USD 0,50 el millón.
 *
 * Es la base, Gemini 3.1 Flash-Lite, mezclada 80/20 entre entrada y salida
 * (0,8 × 0,25 + 0,2 × 1,50 = 0,50): la misma definición que tenía el
 * multiplicador. Unidades = costo en USD × 2.000.000. Los cupos
 * (`aiTokenAllowance`) y los créditos están en esta unidad y no cambian de
 * valor; lo que cambia es cuántas unidades cuesta cada llamada.
 */
const USD_POR_MILLON_DE_UNIDADES = 0.5;

/** La mezcla con la que se definió la unidad; el panel la usa para comparar modelos. */
const MEZCLA_ENTRADA = 0.8;

/** Precio de lista en USD por millón de fichas. */
interface Tarifa {
  /** Entrada que NO vino de caché. */
  entrada: number;
  /** Salida, con el razonamiento adentro: el SDK lo cuenta como parte de la salida. */
  salida: number;
  /** Entrada releída de caché. */
  cache: number;
}

/** Una tarifa y el instante (UTC) desde el que vale. Sin `desde`, vale desde siempre. */
interface Tramo extends Tarifa {
  desde?: string;
}

type PrecioDelModelo =
  /** Precio de lista del proveedor, por tramos de vigencia, del más viejo al más nuevo. */
  | { tipo: 'lista'; tramos: readonly Tramo[] }
  /**
   * Sin precio de lista acá: se cobra como antes, `multiplicador` unidades por
   * ficha de entrada o de salida (USD 0,50 × multiplicador el millón, las dos
   * iguales) y la caché con el factor del proveedor. No se les inventa un
   * precio: se conserva la cuenta con la que se fijaron los cupos de quienes
   * ya los usan.
   */
  | { tipo: 'equivalencia'; multiplicador: number };

/**
 * Gemini 3.7 Flash y 3.8 Flash cuestan lo mismo, y los dos duplican el precio el
 * 1-1-2027 (ai.google.dev/gemini-api/docs/pricing, consultado el 2026-09-29).
 *
 * Antes no estaban en la tabla y se cobraban a 1×: la mezcla 80/20 salía 2,7
 * veces más barata de lo que cuesta. Un multiplicador de 2,7 tampoco alcanzaba:
 * la caché se contaba al 25% de la entrada y Google la cobra al 10%, así que a
 * las empresas con mucha caché les habría cobrado ~60% de más. Por eso cada
 * parte lleva su precio.
 */
const GEMINI_FLASH_3X: readonly Tramo[] = [
  { entrada: 0.75, salida: 3.75, cache: 0.075 },
  // Medianoche UTC: contra el día de facturación de Google son unas horas de un solo día.
  { desde: '2027-01-01T00:00:00Z', entrada: 1.5, salida: 7.5, cache: 0.15 }
];

/** La base: la unidad del cupo se definió con este modelo. */
const MODELO_BASE = 'gemini-3.1-flash-lite';

const TRAMOS_BASE: readonly Tramo[] = [{ entrada: 0.25, salida: 1.5, cache: 0.025 }];

/**
 * Lo que paga un modelo que nadie cargó en la tabla: la tarifa de lista más cara
 * que conocemos, no la de la base.
 *
 * Se cobraba como la base y eso regalaba: para el uso real del agente (mucha
 * entrada y caché, poca salida), el próximo Flash que publique Google se habría
 * descontado a un tercio de lo que cuesta, igual que pasó con el 3.7. Cobrar de
 * más hasta que alguien lo agregue a PRECIO_POR_MODELO es el error que se nota
 * y se corrige; cobrar de menos no se nota hasta la factura.
 */
const MODELO_SIN_PRECIO = 'gemini-3.8-flash';
const TRAMOS_SIN_PRECIO = GEMINI_FLASH_3X;

/**
 * El precio de cada modelo que conocemos. Vale desde que se desplegó: las filas
 * ya registradas conservan las unidades con las que se cobraron.
 */
const PRECIO_POR_MODELO: Record<string, PrecioDelModelo> = {
  [MODELO_BASE]: { tipo: 'lista', tramos: TRAMOS_BASE },
  'gemini-3.7-flash': { tipo: 'lista', tramos: GEMINI_FLASH_3X },
  'gemini-3.8-flash': { tipo: 'lista', tramos: GEMINI_FLASH_3X },
  // Sin dato de caché: la proporción que el código ya usaba para Google.
  'gemini-2.5-flash': {
    tipo: 'lista',
    tramos: [{ entrada: 0.3, salida: 2.5, cache: 0.3 * CACHE_READ_FACTOR.google }]
  },

  // Equivalencias legadas: dan exactamente lo mismo que el multiplicador de
  // antes. Los alias los mueve Google solo, sin avisar, así que no hay un precio
  // de lista que les corresponda con certeza.
  'gemini-flash-lite-latest': { tipo: 'equivalencia', multiplicador: 1 },
  'gemini-flash-latest': { tipo: 'equivalencia', multiplicador: 1.5 },
  'gemini-2.5-flash-lite': { tipo: 'equivalencia', multiplicador: 1 },
  'gpt-5.4-mini': { tipo: 'equivalencia', multiplicador: 4 },
  'claude-sonnet-4-6': { tipo: 'equivalencia', multiplicador: 11 },
  'claude-haiku-4-5-20251001': { tipo: 'equivalencia', multiplicador: 1.5 },
  'kimi-k2.6': { tipo: 'equivalencia', multiplicador: 4 }
};

type PrecioResuelto =
  | { tipo: 'lista'; tarifa: Tarifa; isMeasured: boolean }
  | { tipo: 'equivalencia'; multiplicador: number; isMeasured: true };

function tarifaVigente(tramos: readonly Tramo[], at: Date): Tarifa {
  let vigente = tramos[0];

  for (const tramo of tramos) {
    if (!tramo.desde || Date.parse(tramo.desde) <= at.getTime()) vigente = tramo;
  }

  return vigente;
}

const modelosSinPrecioAvisados = new Set<string>();

/**
 * La tarifa de un modelo en un momento dado.
 *
 * Un modelo que nadie cargó en la tabla se cobra con la tarifa más cara que
 * conocemos (`TRAMOS_SIN_PRECIO`) y queda marcado como no medido. Es una
 * suposición, así que se avisa en el log — una vez por modelo y por proceso,
 * para no inundarlo en una tanda de 40 pasos —, y el panel la muestra como tal.
 * La caché de esa tarifa es un descuento de Google: si al modelo desconocido lo
 * sirve otro proveedor, su caché se cobra con el factor de ESE proveedor, y
 * entera si tampoco lo conocemos.
 */
function resolverPrecio(model: string, provider: string | undefined, at: Date): PrecioResuelto {
  // `hasOwn` y no `PRECIO_POR_MODELO[model]`: un nombre como `constructor`
  // encontraría algo en el prototipo y se cobraría con eso.
  const precio = Object.hasOwn(PRECIO_POR_MODELO, model) ? PRECIO_POR_MODELO[model] : undefined;

  if (precio?.tipo === 'equivalencia') {
    return { tipo: 'equivalencia', multiplicador: precio.multiplicador, isMeasured: true };
  }

  if (precio) {
    return { tipo: 'lista', tarifa: tarifaVigente(precio.tramos, at), isMeasured: true };
  }

  if (!modelosSinPrecioAvisados.has(model)) {
    modelosSinPrecioAvisados.add(model);
    console.warn(
      `[usage] modelo sin precio medido: "${model}" — se cobra como ${MODELO_SIN_PRECIO}, la tarifa más cara que conocemos. Agregalo a PRECIO_POR_MODELO.`
    );
  }

  const supuesta = tarifaVigente(TRAMOS_SIN_PRECIO, at);
  const tarifa =
    provider === 'google' ? supuesta : { ...supuesta, cache: supuesta.entrada * getCacheReadFactor(provider) };

  return { tipo: 'lista', tarifa, isMeasured: false };
}

/**
 * Cuánto más caro que la base sale un modelo, y si ese número está medido.
 *
 * Exportado porque el panel de la plataforma ofrece los modelos que informa
 * Google, no una lista armada a mano, y muestra este número al lado de cada uno.
 * Es la mezcla 80/20 contra la de la base, al precio vigente en `at`: una
 * referencia para elegir. Lo que se descuenta del cupo se calcula llamada por
 * llamada con la entrada, la salida y la caché de verdad (`computeCostUnits`).
 */
export function getModelCostMultiplier(
  model: string,
  at: Date = new Date()
): { multiplier: number; isMeasured: boolean } {
  const precio = resolverPrecio(model, undefined, at);

  if (precio.tipo === 'equivalencia') {
    return { multiplier: precio.multiplicador, isMeasured: true };
  }

  const mezcla = MEZCLA_ENTRADA * precio.tarifa.entrada + (1 - MEZCLA_ENTRADA) * precio.tarifa.salida;

  // A dos decimales: 0,8 × 0,30 + 0,2 × 2,50 da 1,4800000000000002 en coma flotante.
  return { multiplier: Math.round((mezcla / USD_POR_MILLON_DE_UNIDADES) * 100) / 100, isMeasured: precio.isMeasured };
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
 *
 * Un modelo con precio de lista se cobra en dólares: entrada nueva, caché y
 * salida, cada una a su precio, pasadas a unidades (USD × 2.000.000). `at` es
 * el momento de la llamada; existe para que el cambio de precio de una fecha se
 * pueda probar sin esperar a esa fecha.
 */
export function computeCostUnits(usage: TokenUsage, model: string, provider?: string, at: Date = new Date()): number {
  const cacheRead = Math.min(usage.cacheReadTokens ?? 0, usage.promptTokens);
  const freshInput = usage.promptTokens - cacheRead;
  const precio = resolverPrecio(model, provider, at);

  if (precio.tipo === 'equivalencia') {
    // La cuenta de antes, tal cual y en el mismo orden: pasarla por dólares
    // podría mover un redondeo, y estas empresas tienen el cupo fijado con esta.
    const weightedInput = freshInput + cacheRead * getCacheReadFactor(provider);

    return Math.round((weightedInput + usage.completionTokens) * precio.multiplicador);
  }

  const { entrada, salida, cache } = precio.tarifa;
  // Fichas × USD por millón = millonésimas de dólar; una unidad vale 0,50 de esas.
  const microdolares = freshInput * entrada + cacheRead * cache + usage.completionTokens * salida;

  return Math.round(microdolares / USD_POR_MILLON_DE_UNIDADES);
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
