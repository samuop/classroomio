import type { ApiClientConfig, RequestConfig } from './types';
import { env } from '$env/dynamic/public';

// Default configuration
export const DEFAULT_CONFIG: Required<ApiClientConfig> = {
  baseURL: env.PUBLIC_SERVER_URL || '',
  timeout: 30000, // 30 seconds
  retries: 1,
  retryDelay: 1000, // 1 second
  customFetch: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, init),
  onAuthError: async () => {
    // Default: redirect to login or refresh token
    console.warn('Authentication error occurred. Consider redirecting to login.');
  },
  onNetworkError: async (error: Error) => {
    console.error('Network error:', error);
  },
  onResponse: async (response: Response) => {
    // Default: log response for debugging
    if (process.env.NODE_ENV === 'development') {
      console.log(`API Response: ${response.status} ${response.statusText}`);
    }
  }
};

/**
 * El techo de cualquier espera: Cloudflare corta con un 524 a los 100 s sin
 * cabeceras, así que esperar más del lado del navegador es esperar un error.
 */
export const AI_REQUEST_TIMEOUT_MAX = 90_000;

/**
 * Cuánto espera cada llamada de IA hasta recibir las cabeceras.
 *
 * Los 30 s por defecto son para una pantalla que lee datos. Una llamada que pone
 * a trabajar al modelo tarda más, y con 30 s el navegador abandonaba pedidos que
 * el servidor terminaba igual: la investigación web tarda ~32 s en profundidad
 * normal, y el primer turno de construcción llegó a 38 s. La docente veía
 * «Request timeout» y el pedido seguía corriendo sin nadie esperándolo.
 *
 * El chat está acá como red de seguridad: su espera real es la del stream, que
 * este reloj no mide (se apaga al llegar las cabeceras).
 */
export const AI_REQUEST_TIMEOUT = {
  /** POST /agent/chat, hasta que empieza el stream. */
  chat: AI_REQUEST_TIMEOUT_MAX,
  /** POST /agent/research: el servidor se da 48 s más las lecturas en curso. */
  research: AI_REQUEST_TIMEOUT_MAX,
  /** Subir un archivo: puede leerse mirando cada página con el modelo. */
  upload: AI_REQUEST_TIMEOUT_MAX,
  /** Volver a leer una fuente: es otra subida, o una página leída de nuevo. */
  reread: AI_REQUEST_TIMEOUT_MAX,
  /** POST /agent/documents/url: una página, leída por un servicio externo. */
  webPage: 45_000,
  /** Redibujar una imagen o un diagrama de una lección. */
  image: 60_000,
  /** Resumir o compactar una conversación. */
  summary: 60_000
} as const;

/**
 * Las opciones de `apiClient.request` para una llamada de IA: su propio reloj,
 * y SIN reintento.
 *
 * El reintento automático reenvía el pedido ante un 5xx o un error de red, y
 * para un POST que crea algo —una ronda del agente, una fuente, una imagen— eso
 * es hacerlo dos veces: un 502 durante un despliegue podía arrancar una segunda
 * ronda sobre la misma conversación.
 */
export function opcionesDeIA(timeout: number): Pick<RequestConfig, 'timeout' | 'retries'> {
  return { timeout: Math.min(timeout, AI_REQUEST_TIMEOUT_MAX), retries: 0 };
}

/**
 * Lo mismo, con la forma del segundo argumento del cliente RPC: el `init` que
 * Hono le pasa tal cual al `fetch` del cliente, que es el que lee el reloj.
 */
export function llamadaDeIA(timeout: number): { init: RequestInit } {
  const init: RequestConfig = opcionesDeIA(timeout);

  return { init };
}
