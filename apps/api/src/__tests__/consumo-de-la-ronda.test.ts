import { describe, expect, it, vi } from 'vitest';

import { crearConsumoDeLaRonda, usoDelPaso } from '@api/services/agent/consumo-de-la-ronda';

/**
 * El consumo del constructor se registra paso por paso.
 *
 * Medido el 2026-09-29: tres rondas de construcción cortadas, unos 26 pasos del
 * constructor, no dejaron ni una fila en `ai_token_usage`: la única fila de una
 * ronda se escribía en `onFinish`, y una ronda cortada no llegaba ahí. Lo que
 * prueba que la ruta lo usa en `onStepFinish` —y que no cobra el total otra
 * vez— está en `ronda-del-chat.test.ts`; acá, la fila de un paso.
 */

describe('la fila de un paso', () => {
  it('lleva lo que el proveedor informó, con el desglose de caché y razonamiento', () => {
    expect(
      usoDelPaso({
        inputTokens: 1_000,
        outputTokens: 80,
        totalTokens: 1_095,
        inputTokenDetails: { noCacheTokens: 400, cacheReadTokens: 600, cacheWriteTokens: undefined },
        outputTokenDetails: { textTokens: 60, reasoningTokens: 20 }
      })
    ).toEqual({
      promptTokens: 1_000,
      completionTokens: 80,
      // El total del proveedor, no la suma: es lo que facturó.
      totalTokens: 1_095,
      reasoningTokens: 20,
      cacheReadTokens: 600,
      cacheWriteTokens: undefined
    });
  });

  it('sin total del proveedor, suma entrada y salida', () => {
    expect(usoDelPaso({ inputTokens: 10, outputTokens: 5 } as never)).toMatchObject({ totalTokens: 15 });
  });

  it('un paso sin consumo no deja fila', () => {
    expect(usoDelPaso(undefined)).toBeNull();
    expect(usoDelPaso({ inputTokens: 0, outputTokens: 0 } as never)).toBeNull();
  });
});

describe('el registro de la ronda', () => {
  it('registra cada paso una vez y cuenta cuántos quedaron', async () => {
    const registrar = vi.fn(async () => {});
    const consumo = crearConsumoDeLaRonda(registrar);

    await consumo.alTerminarPaso({ inputTokens: 100, outputTokens: 10, totalTokens: 110 } as never);
    await consumo.alTerminarPaso({ inputTokens: 200, outputTokens: 20, totalTokens: 220 } as never);

    expect(registrar).toHaveBeenCalledTimes(2);
    expect(registrar).toHaveBeenNthCalledWith(1, expect.objectContaining({ promptTokens: 100, totalTokens: 110 }));
    expect(registrar).toHaveBeenNthCalledWith(2, expect.objectContaining({ promptTokens: 200, totalTokens: 220 }));
    expect(consumo.pasosRegistrados).toBe(2);
  });

  it('si la base falla, no corta la ronda: queda en el log y el paso no cuenta', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const consumo = crearConsumoDeLaRonda(async () => {
      throw new Error('la base no contestó');
    });

    await expect(consumo.alTerminarPaso({ inputTokens: 100, outputTokens: 10 } as never)).resolves.toBeUndefined();

    expect(consumo.pasosRegistrados).toBe(0);
    // El SDK se traga lo que tire un `onStepFinish`: sin este log no habría rastro.
    expect(error).toHaveBeenCalledWith('[agent.chat] no se pudo registrar el consumo del paso:', expect.any(Error));
    error.mockRestore();
  });
});
