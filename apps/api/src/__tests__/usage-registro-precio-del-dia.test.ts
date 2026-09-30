/**
 * Lo que se registra en el cupo lleva el precio del día de la llamada.
 *
 * `computeCostUnits` recibe la fecha para que el cambio de precio del 1-1-2027
 * se pueda probar sin esperarlo; en la app la pone `recordTokenUsage`, con la
 * hora del servidor. Si esa fecha quedara fija, o si el modelo o el proveedor se
 * perdieran en el camino, el cupo se descontaría con otro precio y nada fallaría
 * a la vista: la fila se guarda igual, con un número equivocado.
 *
 * Empresa, persona y curso inventados.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getActiveOrganizationPlan = vi.fn();
const insertTokenUsageAndDrainCredits = vi.fn(async () => undefined);

vi.mock('@cio/db/queries/organization', () => ({
  getActiveOrganizationPlan: (...a: unknown[]) => getActiveOrganizationPlan(...(a as []))
}));

vi.mock('@cio/db/queries/agent', () => ({
  insertTokenUsageAndDrainCredits: (...a: unknown[]) => insertTokenUsageAndDrainCredits(...(a as [])),
  aggregateTokenUsageByUser: vi.fn(),
  countRequests: vi.fn(),
  getDailyTokenUsageHistory: vi.fn(),
  getMonthlyTokenUsage: vi.fn(),
  getOrgCreditBalance: vi.fn(),
  summarizePurchases: vi.fn(),
  upsertCreditBalance: vi.fn()
}));

const { recordTokenUsage } = await import('@api/services/agent/usage');

const EMPRESA = '00000000-0000-4000-8000-00000000e001';
const PERSONA = '00000000-0000-4000-8000-00000000a001';
const CURSO = '00000000-0000-4000-8000-00000000c001';

/** Lo que registró cada llamada, en orden. */
const filasRegistradas = () =>
  insertTokenUsageAndDrainCredits.mock.calls.map((llamada) => (llamada as unknown[])[0] as Record<string, unknown>);

beforeEach(() => {
  vi.clearAllMocks();
  getActiveOrganizationPlan.mockResolvedValue({ planName: 'ENTERPRISE', payload: { aiTokenAllowance: 30_000_000 } });
  vi.useFakeTimers({ toFake: ['Date'] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('recordTokenUsage', () => {
  it('cobra con el precio vigente el día de la llamada: el de 2026 hasta fin de año y el doble desde el 1-1-2027', async () => {
    // Como la arma la ronda del agente: sin caché informada, el campo va undefined.
    const unMillonDeEntrada = {
      promptTokens: 1_000_000,
      completionTokens: 0,
      totalTokens: 1_000_000,
      reasoningTokens: undefined,
      cacheReadTokens: undefined,
      cacheWriteTokens: undefined
    };

    vi.setSystemTime(new Date('2026-12-31T23:00:00Z'));
    await recordTokenUsage(EMPRESA, PERSONA, CURSO, unMillonDeEntrada, 'gemini-3.7-flash', 'google');

    vi.setSystemTime(new Date('2027-01-01T01:00:00Z'));
    await recordTokenUsage(EMPRESA, PERSONA, CURSO, unMillonDeEntrada, 'gemini-3.7-flash', 'google');

    expect(filasRegistradas().map((fila) => fila.costUnits)).toEqual([1_500_000, 3_000_000]);
  });

  it('pasa la caché y el modelo a la cuenta, y el tope del plan al descuento de créditos', async () => {
    vi.setSystemTime(new Date('2026-10-15T12:00:00Z'));

    // Una ronda de construcción con 65% de caché: 35k × 0,75 + 65k × 0,075 +
    // 4k × 3,75 = 46.125 millonésimas de dólar = 92.250 unidades.
    await recordTokenUsage(
      EMPRESA,
      PERSONA,
      CURSO,
      {
        promptTokens: 100_000,
        completionTokens: 4_000,
        totalTokens: 104_000,
        reasoningTokens: 1_200,
        cacheReadTokens: 65_000,
        cacheWriteTokens: undefined
      },
      'gemini-3.7-flash',
      'google'
    );

    const [fila] = filasRegistradas();

    expect(fila).toMatchObject({
      orgId: EMPRESA,
      userId: PERSONA,
      courseId: CURSO,
      model: 'gemini-3.7-flash',
      promptTokens: 100_000,
      cacheReadTokens: 65_000,
      costUnits: 92_250,
      planAllowance: 30_000_000
    });
    expect(Number.isInteger(fila.costUnits)).toBe(true);
  });
});
