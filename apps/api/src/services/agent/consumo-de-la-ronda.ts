import type { LanguageModelUsage } from 'ai';
import type { TokenUsage } from '@cio/ai-assistant';

/**
 * El consumo de una ronda del chat, registrado paso por paso.
 *
 * ── Por qué por paso y no al final ──────────────────────────────────────────
 *
 * Se registraba UNA fila por ronda, con el total, en el `onFinish` de
 * `streamText`. Una ronda que no llegaba al final no dejaba nada: medido el
 * 2026-09-29, tres rondas de construcción cortadas —unos 26 pasos del
 * constructor, del orden de 0,8 M de fichas de entrada— no se descontaron del
 * cupo de la empresa. Los subagentes (escritor, fundamento, preguntas) sí
 * quedaron, porque cada uno registra su llamada al terminarla.
 *
 * El constructor ahora hace lo mismo: cada paso se registra en `onStepFinish`,
 * con `step.usage`, apenas el proveedor lo informa. `onFinish` ya no registra
 * nada —sólo cierra: logs, métricas—, así que no hay forma de contar dos veces.
 * Y como la ronda ahora termina aunque el navegador se vaya (`ronda-viva.ts`),
 * no queda ningún paso sin su fila.
 *
 * La suma de las filas es el total de la ronda: el costo es lineal en las
 * fichas, así que partirlo por paso no cambia lo que se cobra.
 */

/** La fila de `ai_token_usage` que corresponde al uso de un paso, o `null` si no hay nada que cobrar. */
export function usoDelPaso(uso: LanguageModelUsage | undefined): TokenUsage | null {
  if (!uso) return null;

  const entrada = uso.inputTokens ?? 0;
  const salida = uso.outputTokens ?? 0;

  if (entrada === 0 && salida === 0 && !uso.totalTokens) return null;

  return {
    promptTokens: entrada,
    completionTokens: salida,
    // El total que informa el proveedor, sin recalcular: es lo que facturó.
    totalTokens: uso.totalTokens ?? entrada + salida,
    reasoningTokens: uso.outputTokenDetails?.reasoningTokens || undefined,
    cacheReadTokens: uso.inputTokenDetails?.cacheReadTokens || undefined,
    cacheWriteTokens: uso.inputTokenDetails?.cacheWriteTokens || undefined
  };
}

export interface ConsumoDeLaRonda {
  /** Registra el uso de un paso que acaba de terminar. Nunca tira: un fallo queda en el log. */
  alTerminarPaso(uso: LanguageModelUsage | undefined): Promise<void>;
  /** Cuántos pasos quedaron registrados. Para el log del cierre. */
  readonly pasosRegistrados: number;
}

export function crearConsumoDeLaRonda(registrar: (uso: TokenUsage) => Promise<void>): ConsumoDeLaRonda {
  let pasosRegistrados = 0;

  return {
    async alTerminarPaso(uso) {
      const fila = usoDelPaso(uso);

      if (!fila) return;

      try {
        await registrar(fila);
        pasosRegistrados += 1;
      } catch (error) {
        // El SDK se traga en silencio lo que tire un `onStepFinish`: sin este
        // log, un paso sin cobrar no dejaría rastro.
        console.error('[agent.chat] no se pudo registrar el consumo del paso:', error);
      }
    },
    get pasosRegistrados() {
      return pasosRegistrados;
    }
  };
}
