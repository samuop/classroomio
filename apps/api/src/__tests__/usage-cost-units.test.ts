import { afterEach, describe, expect, it, vi } from 'vitest';

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
 * Y por el error siguiente, medido en septiembre: Gemini 3.7 Flash no estaba en
 * la tabla y se descontaba a 1×, cuando la mezcla 80/20 cuesta 2,7 veces la
 * base. Un 2,7× parejo tampoco servía, porque la caché se contaba al 25% de la
 * entrada y Google la cobra al 10%. Desde entonces un modelo con precio de
 * lista se cobra en dólares: entrada nueva, caché y salida, cada una a su
 * precio, y una unidad vale USD 0,50 el millón.
 *
 * Es el tipo de error que ninguna herramienta puede ver: no rompe nada, no tira
 * ningún error, sólo cobra de más o de menos. La única defensa es un test que
 * fije la cuenta.
 */

const uso = (cambios: Partial<Parameters<typeof computeCostUnits>[0]> = {}) => {
  const promptTokens = cambios.promptTokens ?? 100_000;
  const completionTokens = cambios.completionTokens ?? 1_000;

  return { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens, ...cambios };
};

/** Fechas fijas: el precio de 3.x Flash cambia el 1-1-2027 y el test no puede depender del día en que corre. */
const EN_2026 = new Date('2026-09-29T15:00:00Z');
const EN_2027 = new Date('2027-01-01T00:00:00Z');

const BASE = 'gemini-3.1-flash-lite';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('computeCostUnits', () => {
  it('cobra la relectura de caché a fracción, no entera', () => {
    // 100k de entrada, de los cuales 80k son prefijo cacheado. Flash-Lite cobra
    // la entrada nueva a USD 0,25 el millón y la caché a 0,025:
    // 20k × 0,25 + 80k × 0,025 + 1k × 1,50 = 8.500 millonésimas = 17.000 u.
    const conCache = computeCostUnits(uso({ cacheReadTokens: 80_000 }), BASE, 'google');

    expect(conCache).toBe(17_000);
    expect(conCache).toBeLessThan(computeCostUnits(uso(), BASE, 'google'));
  });

  it('sin caché cobra toda la entrada como nueva', () => {
    // Si esto bajara, el arreglo de la caché estaría cobrando de menos:
    // 100k × 0,25 + 1k × 1,50 = 26.500 millonésimas = 53.000 u.
    expect(computeCostUnits(uso(), BASE, 'google')).toBe(53_000);
  });

  it('el descuento depende del proveedor, no es un 10% para todos', () => {
    // En las equivalencias legadas la caché sigue el factor del proveedor.
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

    expect(computeCostUnits(uso({ cacheReadTokens: 80_000 }), 'gemini-flash-lite-latest', 'minimax')).toBe(101_000);
  });

  it('no se rompe si el proveedor reporta más caché que entrada', () => {
    // No debería pasar (es un subconjunto), pero si pasara, restar a lo bruto
    // daría entrada NEGATIVA y la llamada saldría más barata, o gratis. Se
    // cobra como si toda la entrada hubiera venido de caché.
    const raro = computeCostUnits(uso({ promptTokens: 1_000, cacheReadTokens: 5_000 }), BASE, 'google');

    expect(raro).toBeGreaterThan(0);
    expect(raro).toBe(computeCostUnits(uso({ promptTokens: 1_000, cacheReadTokens: 1_000 }), BASE, 'google'));
  });

  it('aplica el multiplicador del modelo sobre lo ya ponderado', () => {
    // 20k frescos + 80k × 0,1 = 28k, +1k salida = 29k, × 11 (Sonnet).
    const caro = computeCostUnits(uso({ cacheReadTokens: 80_000 }), 'claude-sonnet-4-6', 'anthropic');

    expect(caro).toBe(29_000 * 11);
  });
});

describe('precio por modelo', () => {
  const unMillonDeEntrada = uso({ promptTokens: 1_000_000, completionTokens: 0 });
  const unMillonDeCache = uso({ promptTokens: 1_000_000, cacheReadTokens: 1_000_000, completionTokens: 0 });
  const unMillonDeSalida = uso({ promptTokens: 0, completionTokens: 1_000_000 });

  it('Gemini 3.7 Flash: 1M de entrada nueva son USD 0,75, o sea 1.500.000 unidades', () => {
    expect(computeCostUnits(unMillonDeEntrada, 'gemini-3.7-flash', 'google', EN_2026)).toBe(1_500_000);
  });

  it('1M leído de caché son USD 0,075: 150.000 unidades, el 10% de la entrada y no el 25%', () => {
    expect(computeCostUnits(unMillonDeCache, 'gemini-3.7-flash', 'google', EN_2026)).toBe(150_000);
  });

  it('1M de salida son USD 3,75: 7.500.000 unidades', () => {
    expect(computeCostUnits(unMillonDeSalida, 'gemini-3.7-flash', 'google', EN_2026)).toBe(7_500_000);
  });

  it('las tres partes se suman cada una con su precio, no con un multiplicador parejo', () => {
    // Una ronda típica de construcción: 65% de caché y poca salida.
    // 35k × 0,75 + 65k × 0,075 + 4k × 3,75 = 46.125 millonésimas = 92.250 u.
    // Con un 2,7× parejo sobre la cuenta vieja habrían sido
    // (35k + 65k × 0,25 + 4k) × 2,7 = 149.175: un 62% de más.
    const ronda = uso({ promptTokens: 100_000, cacheReadTokens: 65_000, completionTokens: 4_000 });

    expect(computeCostUnits(ronda, 'gemini-3.7-flash', 'google', EN_2026)).toBe(92_250);
  });

  it('el 1-1-2027 el precio de 3.x Flash se duplica, y ni un instante antes', () => {
    const ultimoInstanteDe2026 = new Date('2026-12-31T23:59:59.999Z');

    expect(computeCostUnits(unMillonDeEntrada, 'gemini-3.7-flash', 'google', ultimoInstanteDe2026)).toBe(1_500_000);

    expect(computeCostUnits(unMillonDeEntrada, 'gemini-3.7-flash', 'google', EN_2027)).toBe(3_000_000);
    expect(computeCostUnits(unMillonDeCache, 'gemini-3.7-flash', 'google', EN_2027)).toBe(300_000);
    expect(computeCostUnits(unMillonDeSalida, 'gemini-3.7-flash', 'google', EN_2027)).toBe(15_000_000);
  });

  it('3.8 Flash cuesta lo mismo que 3.7 Flash, antes y después del cambio', () => {
    for (const fecha of [EN_2026, EN_2027]) {
      for (const llamada of [unMillonDeEntrada, unMillonDeCache, unMillonDeSalida]) {
        expect(computeCostUnits(llamada, 'gemini-3.8-flash', 'google', fecha)).toBe(
          computeCostUnits(llamada, 'gemini-3.7-flash', 'google', fecha)
        );
      }
    }
  });

  it('una unidad sigue valiendo USD 0,50 el millón: 1M de la base mezclado 80/20 es 1M de unidades', () => {
    // Los cupos (`aiTokenAllowance`) y los créditos están en esta unidad. Si su
    // valor se moviera, cada cupo fijado a mano pasaría a significar otra plata.
    const mezcla = uso({ promptTokens: 800_000, completionTokens: 200_000 });

    expect(computeCostUnits(mezcla, BASE, 'google', EN_2026)).toBe(1_000_000);
    expect(computeCostUnits(mezcla, BASE, 'google', EN_2027)).toBe(1_000_000);
  });

  it('gemini-2.5-flash toma la caché con la proporción que ya se usaba para Google', () => {
    // Entrada 0,30 y salida 2,50; la caché, 0,30 × 0,25 = 0,075.
    expect(computeCostUnits(uso({ promptTokens: 1_000_000, completionTokens: 0 }), 'gemini-2.5-flash', 'google')).toBe(
      600_000
    );
    expect(computeCostUnits(unMillonDeCache, 'gemini-2.5-flash', 'google')).toBe(150_000);
    expect(computeCostUnits(unMillonDeSalida, 'gemini-2.5-flash', 'google')).toBe(5_000_000);
  });
});

describe('equivalencias legadas', () => {
  // La tabla y la cuenta de ANTES, copiadas tal como estaban: son el testigo.
  const MULTIPLICADOR_DE_ANTES: Record<string, number> = {
    'gemini-flash-lite-latest': 1,
    'gemini-flash-latest': 1.5,
    'gemini-2.5-flash-lite': 1,
    'gpt-5.4-mini': 4,
    'claude-sonnet-4-6': 11,
    'claude-haiku-4-5-20251001': 1.5,
    'kimi-k2.6': 4
  };
  const FACTOR_DE_CACHE_DE_ANTES: Record<string, number> = {
    anthropic: 0.1,
    google: 0.25,
    openai: 0.5,
    moonshot: 0.1,
    minimax: 1
  };

  const cuentaDeAntes = (llamada: ReturnType<typeof uso>, model: string, provider: string | undefined) => {
    const cacheRead = Math.min(llamada.cacheReadTokens ?? 0, llamada.promptTokens);
    const fresca = llamada.promptTokens - cacheRead;
    const factor = (provider ? FACTOR_DE_CACHE_DE_ANTES[provider] : undefined) ?? 1;

    return Math.round((fresca + cacheRead * factor + llamada.completionTokens) * MULTIPLICADOR_DE_ANTES[model]);
  };

  it('dan exactamente lo mismo que el multiplicador de antes, con cualquier proveedor y en cualquier fecha', () => {
    const llamadas = [
      uso(),
      uso({ cacheReadTokens: 80_000 }),
      uso({ promptTokens: 12_345, cacheReadTokens: 6_789, completionTokens: 777 }),
      // Justo en medio: 3 × 1,5 = 4,5 y 5 × 0,1 × 11 = 5,5 se redondean hacia arriba.
      uso({ promptTokens: 3, completionTokens: 0 }),
      uso({ promptTokens: 5, cacheReadTokens: 5, completionTokens: 0 })
    ];
    const proveedores = ['google', 'anthropic', 'openai', 'moonshot', 'minimax', undefined];
    const distintas: string[] = [];

    for (const model of Object.keys(MULTIPLICADOR_DE_ANTES)) {
      for (const provider of proveedores) {
        for (const llamada of llamadas) {
          for (const fecha of [EN_2026, EN_2027]) {
            const ahora = computeCostUnits(llamada, model, provider, fecha);
            const antes = cuentaDeAntes(llamada, model, provider);

            if (ahora !== antes) {
              distintas.push(`${model} / ${provider} / ${JSON.stringify(llamada)}: ${ahora} en vez de ${antes}`);
            }
          }
        }
      }
    }

    expect(distintas).toEqual([]);
  });

  it('muestran en el panel el mismo multiplicador que antes, como medido', () => {
    for (const [model, multiplicador] of Object.entries(MULTIPLICADOR_DE_ANTES)) {
      expect(getModelCostMultiplier(model)).toEqual({ multiplier: multiplicador, isMeasured: true });
    }
  });
});

describe('modelo desconocido', () => {
  it('se cobra con la tarifa más cara que conocemos (3.x Flash), no como la base, y queda marcado como no medido', () => {
    // Como la base regalaba: el próximo Flash que publique Google, elegido en el
    // panel antes de que alguien lo cargue en la tabla, se habría descontado a
    // un tercio de lo que cuesta. Cobrar de más se nota y se corrige.
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    for (const llamada of [
      uso(),
      uso({ cacheReadTokens: 80_000 }),
      uso({ promptTokens: 0, completionTokens: 5_000 })
    ]) {
      for (const fecha of [EN_2026, EN_2027]) {
        const desconocido = computeCostUnits(llamada, 'gemini-9.9-inventado', 'google', fecha);

        expect(desconocido).toBe(computeCostUnits(llamada, 'gemini-3.8-flash', 'google', fecha));
        expect(desconocido).toBeGreaterThan(computeCostUnits(llamada, BASE, 'google', fecha));
      }
    }

    expect(getModelCostMultiplier('gemini-9.9-inventado', EN_2026)).toEqual({ multiplier: 2.7, isMeasured: false });
  });

  it('avisa en el log una sola vez por modelo y por proceso', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    computeCostUnits(uso(), 'modelo-que-avisa-una-vez', 'google');
    computeCostUnits(uso(), 'modelo-que-avisa-una-vez', 'google');
    getModelCostMultiplier('modelo-que-avisa-una-vez');

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('modelo sin precio medido: "modelo-que-avisa-una-vez"');
  });

  it('si lo sirve otro proveedor, la caché sigue el descuento de ESE proveedor', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    // La caché de la tarifa supuesta es un descuento de Google. MiniMax no tiene
    // uno conocido: su caché se cobra entera, igual que la entrada nueva.
    // 100k × 0,75 + 1k × 3,75 = 78.750 millonésimas = 157.500 u.
    const conCache = computeCostUnits(uso({ cacheReadTokens: 80_000 }), 'MiniMax-M3', 'minimax', EN_2026);

    expect(conCache).toBe(computeCostUnits(uso(), 'MiniMax-M3', 'minimax', EN_2026));
    expect(conCache).toBe(157_500);
  });

  it('un nombre que existe en el prototipo de un objeto también es desconocido', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(computeCostUnits(uso(), 'constructor', 'google', EN_2026)).toBe(
      computeCostUnits(uso(), 'gemini-9.9-inventado', 'google', EN_2026)
    );
    expect(getModelCostMultiplier('toString', EN_2026)).toEqual({ multiplier: 2.7, isMeasured: false });
  });
});

describe('getModelCostMultiplier', () => {
  it('marca como NO medido lo que no está en la tabla', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Es lo que pasaba con `google`, `minimax` y `gemini-3.7-flash`: se cobraban
    // a 1x adivinado. Ahora se cobra con la tarifa más cara conocida, y declarado.
    expect(getModelCostMultiplier('google', EN_2026)).toEqual({ multiplier: 2.7, isMeasured: false });
    expect(getModelCostMultiplier(BASE)).toEqual({ multiplier: 1, isMeasured: true });
  });

  it('muestra la mezcla 80/20 contra la base, al precio de la fecha', () => {
    // 0,8 × 0,75 + 0,2 × 3,75 = 1,35 contra 0,50 de la base: 2,7×; el doble desde 2027.
    expect(getModelCostMultiplier('gemini-3.7-flash', EN_2026)).toEqual({ multiplier: 2.7, isMeasured: true });
    expect(getModelCostMultiplier('gemini-3.7-flash', EN_2027)).toEqual({ multiplier: 5.4, isMeasured: true });
    expect(getModelCostMultiplier('gemini-3.8-flash', EN_2026)).toEqual({ multiplier: 2.7, isMeasured: true });
    // 0,8 × 0,30 + 0,2 × 2,50 = 0,74: redondeado a dos decimales, no 1,4800000000000002.
    expect(getModelCostMultiplier('gemini-2.5-flash')).toEqual({ multiplier: 1.48, isMeasured: true });
  });
});
