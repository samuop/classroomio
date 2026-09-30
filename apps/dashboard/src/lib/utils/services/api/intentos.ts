import { ApiError } from './types';
import { delay } from './utils';

/**
 * El mensaje del `ApiError` que sale cuando vence el reloj de un pedido.
 *
 * Exportado porque hay pantallas que lo tienen que reconocer para traducirlo:
 * crudo, en inglés, era lo único que la docente veía («Request timeout») cuando
 * la investigación o el chat tardaban más de lo previsto.
 */
export const MENSAJE_DE_TIEMPO_AGOTADO = 'Request timeout';

export function mergeAbortSignals(...signals: Array<AbortSignal | null | undefined>) {
  const activeSignals = signals.filter((signal): signal is AbortSignal => Boolean(signal));

  if (activeSignals.length === 0) {
    return undefined;
  }

  if (activeSignals.length === 1) {
    return activeSignals[0];
  }

  const controller = new AbortController();

  const abortWithSignal = (signal: AbortSignal) => {
    if (controller.signal.aborted) {
      return;
    }

    controller.abort(signal.reason);
  };

  for (const signal of activeSignals) {
    if (signal.aborted) {
      abortWithSignal(signal);
      break;
    }

    signal.addEventListener('abort', () => abortWithSignal(signal), { once: true });
  }

  return controller.signal;
}

export interface PedidoConReintentos {
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  url: string;
  /** Todo menos la señal: cada intento arma la suya. */
  init: Omit<RequestInit, 'signal'>;
  /** La de quien llama (el «Detener» del chat, un cambio de pantalla). */
  signal?: AbortSignal | null;
  /** Hasta que llegan las cabeceras, en CADA intento. */
  timeout: number;
  retries: number;
  retryDelay: number;
  onResponse: (response: Response) => Promise<void> | void;
  onAuthError: () => Promise<void> | void;
  onNetworkError: (error: Error) => Promise<void> | void;
}

/**
 * Hace el pedido, con un reloj propio por intento y reintentos ante un 5xx o un
 * error de red.
 *
 * El reloj se arma DENTRO del bucle. Estaba afuera, uno solo para todos los
 * intentos, y el primer intento lo apagaba al recibir las cabeceras (o al
 * fallar): el reintento después de un 502 corría sin ningún tiempo de espera, y
 * un pedido colgado ahí no terminaba nunca.
 *
 * El reloj mide hasta las cabeceras, no el cuerpo: una respuesta que ya empezó a
 * llegar (el stream del chat) no se corta por tardar.
 */
export async function pedirConReintentos(pedido: PedidoConReintentos): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= pedido.retries; attempt++) {
    const reloj = new AbortController();
    const timeoutId = setTimeout(() => reloj.abort(), pedido.timeout);

    try {
      const response = await pedido.fetch(pedido.url, {
        ...pedido.init,
        signal: mergeAbortSignals(pedido.signal, reloj.signal)
      });

      clearTimeout(timeoutId);

      await pedido.onResponse(response);

      if (response.ok) {
        return response;
      }

      if (response.status === 401) {
        await pedido.onAuthError();
        throw new ApiError('Authentication failed', response.status, response.statusText, response);
      }

      if (response.status >= 400 && response.status < 500) {
        const errorText = await response.text().catch(() => 'Unknown error');
        throw new ApiError(errorText, response.status, response.statusText, response);
      }

      if (response.status >= 500) {
        const error = new ApiError(response.statusText, response.status, response.statusText, response);

        if (attempt === pedido.retries) {
          throw error;
        }

        lastError = error;
        await delay(pedido.retryDelay * Math.pow(2, attempt));
        continue;
      }

      // Other status codes
      throw new ApiError(`Unexpected status: ${response.statusText}`, response.status, response.statusText, response);
    } catch (error) {
      clearTimeout(timeoutId);

      // Handle abort (timeout)
      if (error instanceof Error && error.name === 'AbortError') {
        if (!reloj.signal.aborted) {
          throw error;
        }

        throw new ApiError(MENSAJE_DE_TIEMPO_AGOTADO, 408, 'Request Timeout');
      }

      // Handle network errors - retryable
      if (error instanceof TypeError && error.message.includes('fetch')) {
        const networkError = new ApiError('Network error', 0, 'Network Error');

        if (attempt === pedido.retries) {
          await pedido.onNetworkError(networkError);
          throw networkError;
        }

        lastError = networkError;
        await delay(pedido.retryDelay * Math.pow(2, attempt));
        continue;
      }

      // Re-throw non-retryable errors
      throw error;
    }
  }

  // If we get here, all retries failed
  throw lastError || new ApiError('Request failed after all retries');
}
