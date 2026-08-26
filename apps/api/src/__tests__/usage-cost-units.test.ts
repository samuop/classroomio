import { describe, expect, it } from 'vitest';

import { computeCostUnits, getCacheReadFactor, getModelCostMultiplier } from '@api/services/agent/usage';

/**
 * Cuánto le descuenta del cupo una llamada.
 *
 * Existe por un error medido en producción el 2026-08-26: `promptTokens`
 * **incluye** las relecturas de caché (el proveedor las reporta como un
 * subconjunto de la entrada), y el cálculo las cobraba enteras. Ese mes el
 * 64,5% de toda la entrada vino de caché: se cobraron 17,7M de unidades donde
 * lo ponderado daba ~7,6-9,3M. La empresa llegó al tope de un gasto que nunca
 * hizo.
 *
 * Es el tipo de error que ninguna herramienta puede ver: no rompe nada, no tira
 * ningún error, sólo cobra de más. La única defensa es un test que fije la
 * cuenta.
 */

const uso = (cambios: Partial<Parameters<typeof computeCostUnits>[0]> = {}) => ({
  promptTokens: 100_000,
  completionTokens: 1_000,
  totalTokens: 101_000,
  ...cambios
});

describe('computeCostUnits', () => {
  it('cobra la relectura de caché a fracción, no entera', () => {
    // 100k de entrada, de los cuales 80k son prefijo cacheado que Google cobra
    // al 25%: 20k frescos + 80k × 0,25 = 40k, más 1k de salida.
    const conCache = computeCostUnits(uso({ cacheReadTokens: 80_000 }), 'gemini-3.1-flash-lite', 'google');

    expect(conCache).toBe(41_000);
  });

  it('sin caché cobra todo, como antes', () => {
    // La cuenta vieja tiene que seguir valiendo cuando no hay nada cacheado:
    // si esto cambiara, el arreglo estaria cobrando de menos.
    expect(computeCostUnits(uso(), 'gemini-3.1-flash-lite', 'google')).toBe(101_000);
  });

  it('el descuento depende del proveedor, no es un 10% para todos', () => {
    const anthropic = computeCostUnits(uso({ cacheReadTokens: 80_000 }), 'claude-haiku-4-5-20251001', 'anthropic');
    const google = computeCostUnits(uso({ cacheReadTokens: 80_000 }), 'claude-haiku-4-5-20251001', 'google');

    // Anthropic cobra 0,1× y Google 0,25×: con el mismo multiplicador de modelo,
    // Anthropic tiene que salir más barato. Un 0.1 hardcodeado para todos
    // cobraría de menos con Google, que es la falla que nadie nota.
    expect(anthropic).toBeLessThan(google);
  });

  it('un proveedor sin descuento conocido paga precio entero', () => {
    // Nunca inventar un descuento a nuestro favor: si no sabemos qué cobra,
    // se cobra todo. Equivocarse hacia lo barato no lo descubre nadie hasta que
    // llega la factura del proveedor.
    expect(getCacheReadFactor('proveedor-que-no-existe')).toBe(1);
    expect(getCacheReadFactor(undefined)).toBe(1);
    // La cadena vacía también: con `(provider && MAPA[provider]) ?? 1` devolvía
    // `''`, que multiplicando vale 0 y dejaba la caché gratis.
    expect(getCacheReadFactor('')).toBe(1);

    expect(computeCostUnits(uso({ cacheReadTokens: 80_000 }), 'gemini-3.1-flash-lite', 'minimax')).toBe(101_000);
  });

  it('no se rompe si el proveedor reporta más caché que entrada', () => {
    // No debería pasar (es un subconjunto), pero si pasara, restar a lo bruto
    // daría entrada NEGATIVA y la llamada saldría gratis.
    const raro = computeCostUnits(
      uso({ promptTokens: 1_000, cacheReadTokens: 5_000 }),
      'gemini-3.1-flash-lite',
      'google'
    );

    expect(raro).toBeGreaterThan(0);
  });

  it('aplica el multiplicador del modelo sobre lo ya ponderado', () => {
    // 20k frescos + 80k × 0,1 = 28k, +1k salida = 29k, × 11 (Sonnet).
    const caro = computeCostUnits(uso({ cacheReadTokens: 80_000 }), 'claude-sonnet-4-6', 'anthropic');

    expect(caro).toBe(29_000 * 11);
  });
});

describe('getModelCostMultiplier', () => {
  it('marca como NO medido lo que no está en la tabla', () => {
    // Es lo que pasaba con `google`, `minimax` y `gemini-3.7-flash`: se cobraban
    // a 1x adivinado. Ahora sigue siendo 1x, pero declarado.
    expect(getModelCostMultiplier('google')).toEqual({ multiplier: 1, isMeasured: false });
    expect(getModelCostMultiplier('gemini-3.1-flash-lite')).toEqual({ multiplier: 1, isMeasured: true });
  });
});
