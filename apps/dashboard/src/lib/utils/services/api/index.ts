import { type ApiClientConfig, ApiError, type RequestConfig } from './types';

import { DEFAULT_CONFIG } from './constants';
import { delay } from './utils';
import { hcWithType } from '@cio/api/rpc-types';
import { get } from 'svelte/store';
import { currentOrg } from '$lib/utils/store/org';
import type { Cookies } from '@sveltejs/kit';
import { getCioCookieString } from '$lib/utils/functions/cookies';
import { AGENT_CONTENT_TYPE } from '@cio/utils/constants';
import {
  isSlowRequest,
  reportIncident,
  shouldReportFailedRequest
} from '$lib/utils/services/audit/report-incident';

// Importado Y re-exportado: `export { x } from './y'` reexporta pero NO trae el
// nombre al ámbito de este módulo, y `classroomio` de más abajo lo llama. Con
// sólo el re-export, cada render en el servidor moría con
// "getRequestBaseUrl is not defined" y toda página SSR devolvía 500.
import { getRequestBaseUrl } from './base-url';

export { getRequestBaseUrl };

/**
 * La ruta pelada de una URL, como la ve la API.
 *
 * Sin origen (que es siempre el mismo) y sin querystring (que puede llevar
 * términos de búsqueda), y sin el prefijo `/proxy` que agrega el navegador
 * cuando habla con la API del mismo origen. Así la fila que reporta el
 * navegador y la que registra el servidor dicen la misma ruta y se pueden
 * cruzar.
 */
function routePathOf(url: string): string {
  try {
    const { pathname } = new URL(url, 'http://placeholder');

    return pathname.startsWith('/proxy/') ? pathname.slice('/proxy'.length) : pathname;
  } catch {
    return url.slice(0, 200);
  }
}

function isAgentRequest(input: RequestInfo | URL): boolean {
  try {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const pathname = new URL(raw, 'http://placeholder').pathname;
    return pathname.includes('/agent/');
  } catch {
    return false;
  }
}

/**
 * Base64-encode a UTF-8 string for the `/agent/*` body envelope. Works on
 * both the SvelteKit server (Node `Buffer`) and the browser (TextEncoder +
 * `btoa`). `btoa` alone fails on non-Latin-1 characters; encoding through
 * bytes first preserves arbitrary Unicode.
 */
function toBase64Utf8(input: string): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(input, 'utf-8').toString('base64');
  }

  const bytes = new TextEncoder().encode(input);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }

  return btoa(binary);
}

function mergeAbortSignals(...signals: Array<AbortSignal | null | undefined>) {
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

class ApiClient {
  private config: Required<ApiClientConfig>;

  constructor(config: ApiClientConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Mide y reporta cada llamada, y delega el trabajo real a `performRequest`.
   *
   * Este es el único punto por el que pasa TODA la conversación del dashboard
   * con la API —el cliente RPC de Hono lo usa como `fetch`—, así que
   * instrumentarlo acá cubre cada pantalla sin tocar ninguna.
   *
   * Qué se reporta y qué no: sólo lo que el servidor NO puede ver por su cuenta.
   * Un 403 ya quedó registrado del lado de la API con más contexto del que tiene
   * el navegador; duplicarlo sólo ensucia la tabla. Un error de red, en cambio,
   * significa que el request nunca llegó — para el servidor no existió.
   */
  private async makeRequest(input: RequestInfo | URL, requestConfig: RequestConfig = {}): Promise<Response> {
    const startedAt = performance.now();
    const method = (requestConfig.method ?? 'GET').toUpperCase();
    const route = routePathOf(typeof input === 'string' ? input : input.toString());

    try {
      const response = await this.performRequest(input, requestConfig);
      const durationMs = Math.round(performance.now() - startedAt);

      if (isSlowRequest(durationMs)) {
        reportIncident({
          kind: 'SLOW_REQUEST',
          message: `${method} ${route} tardó ${durationMs}ms desde el navegador`,
          route,
          method,
          status: response.status,
          durationMs
        });
      }

      return response;
    } catch (error) {
      const durationMs = Math.round(performance.now() - startedAt);
      const status = error instanceof ApiError ? (error.status ?? 0) : 0;

      if (shouldReportFailedRequest(status, error)) {
        reportIncident({
          kind: 'REQUEST_FAILED',
          message: error instanceof Error ? error.message : String(error),
          route,
          method,
          status,
          durationMs
        });
      }

      throw error;
    }
  }

  private async performRequest(input: RequestInfo | URL, requestConfig: RequestConfig = {}): Promise<Response> {
    const { timeout = this.config.timeout, retries = this.config.retries, ...fetchConfig } = requestConfig;

    // The Hono RPC client already builds a full URL using the base it was
    // constructed with (PRIVATE_SERVER_URL on the server, `${origin}/proxy`
    // in the browser — see `getRequestBaseUrl()` above). Forward it as-is.
    const fullUrl = typeof input === 'string' ? input : input.toString();

    // Prepare headers
    const headers = new Headers(fetchConfig.headers);

    // Add default headers
    if (!headers.has('Accept')) {
      headers.set('Accept', 'application/json');
    }

    // Add organization ID header if available.
    //
    // The active org is the DEFAULT, not an override: a caller that set the
    // header deliberately is asking about a different company, and a consultancy
    // admin reading one of their client companies' learners is exactly that
    // case. Overwriting it here would send every such request to the wrong org.
    const org = get(currentOrg);
    if (org?.id && !headers.has('cio-org-id')) {
      headers.set('cio-org-id', org.id);
    }

    // Handle body serialization and content-type
    let requestBody = fetchConfig.body;
    const isFormData = fetchConfig.body instanceof FormData;

    if (fetchConfig.body && typeof fetchConfig.body === 'object' && !isFormData) {
      // Auto-stringify objects (except FormData)
      requestBody = JSON.stringify(fetchConfig.body);
      if (!headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
      }
    } else if (fetchConfig.body && !headers.has('Content-Type')) {
      // Set content-type for other body types if not already set
      if (typeof fetchConfig.body === 'string') {
        headers.set('Content-Type', 'text/plain');
      }
    }

    if (isFormData) {
      // Let the browser set the multipart boundary, but keep auth/org headers.
      headers.delete('Content-Type');
    }

    if (requestBody && !isFormData && isAgentRequest(input)) {
      // Wrap the inner JSON in a base64 envelope so Render's Cloudflare WAF
      // can't body-inspect the content (AI-generated HTML, code blocks, curl
      // examples, etc. trip OWASP rules). The API's `agentContentTypeRewrite`
      // middleware decodes the envelope before any route handler sees it.
      const inner = typeof requestBody === 'string' ? requestBody : JSON.stringify(requestBody);
      requestBody = JSON.stringify({ b64: toBase64Utf8(inner) });
      headers.set('Content-Type', AGENT_CONTENT_TYPE);
    }

    // Create abort controller for timeout
    const timeoutController = new AbortController();
    const timeoutId = setTimeout(() => timeoutController.abort(), timeout);

    const requestInit: RequestInit = {
      ...fetchConfig,
      headers,
      body: requestBody,
      signal: mergeAbortSignals(fetchConfig.signal, timeoutController.signal)
    };

    let lastError: Error | null = null;

    // Retry logic with exponential backoff
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const response = await this.config.customFetch(fullUrl, requestInit);

        clearTimeout(timeoutId);

        await this.config.onResponse(response);

        if (response.ok) {
          return response;
        }

        if (response.status === 401) {
          await this.config.onAuthError();
          throw new ApiError('Authentication failed', response.status, response.statusText, response);
        }

        if (response.status >= 400 && response.status < 500) {
          const errorText = await response.text().catch(() => 'Unknown error');
          throw new ApiError(errorText, response.status, response.statusText, response);
        }

        if (response.status >= 500) {
          const error = new ApiError(response.statusText, response.status, response.statusText, response);

          if (attempt === retries) {
            throw error;
          }

          lastError = error;
          await delay(this.config.retryDelay * Math.pow(2, attempt));
          continue;
        }

        // Other status codes
        throw new ApiError(`Unexpected status: ${response.statusText}`, response.status, response.statusText, response);
      } catch (error) {
        clearTimeout(timeoutId);

        // Handle abort (timeout)
        if (error instanceof Error && error.name === 'AbortError') {
          if (!timeoutController.signal.aborted) {
            throw error;
          }

          throw new ApiError('Request timeout', 408, 'Request Timeout');
        }

        // Handle network errors - retryable
        if (error instanceof TypeError && error.message.includes('fetch')) {
          const networkError = new ApiError('Network error', 0, 'Network Error');

          if (attempt === retries) {
            await this.config.onNetworkError(networkError);
            throw networkError;
          }

          lastError = networkError;
          await delay(this.config.retryDelay * Math.pow(2, attempt));
          continue;
        }

        // Re-throw non-retryable errors
        throw error;
      }
    }

    // If we get here, all retries failed
    throw lastError || new ApiError('Request failed after all retries');
  }

  // Generic request method - handles all HTTP methods
  async request(input: RequestInfo | URL, config: RequestConfig = {}): Promise<Response> {
    return this.makeRequest(input, config);
  }

  // Update configuration
  updateConfig(newConfig: Partial<ApiClientConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }
}

// Create default instance
export const apiClient = new ApiClient();

// RPC client using the new fetch wrapper
export const classroomio = hcWithType(getRequestBaseUrl(), {
  fetch: async (input: RequestInfo | URL, requestInit?: RequestInit) => {
    return apiClient.request(input, requestInit);
  },
  init: {
    credentials: 'include' // Required for sending cookies cross-origin
  }
});

// Utility functions for common use cases
export const createApiClient = (config: ApiClientConfig) => new ApiClient(config);

// Re-export utility functions for convenience
export {
  handleJsonResponse,
  handleTextResponse,
  isApiError,
  isNetworkError,
  isAuthError,
  isClientError,
  isServerError,
  isTimeoutError,
  safeRequest,
  safeRequestText,
  safeRequestRaw,
  type Result
} from './utils';

export type { InferResponseType, InferRequestType } from '@cio/api/rpc-types';

// Export base API classes
export { BaseApi, BaseApiWithErrors } from './base.svelte';

/**
 * Gets headers with cookies and organization ID for API calls
 * Use this in load functions (+page.server.ts, +layout.server.ts) to pass user session cookies
 * and organization ID to API calls. This ensures authentication and organization context work correctly.
 *
 * @param cookies Cookies object from SvelteKit load function
 * @param orgId Organization ID to include in headers
 * @returns Headers object with cookie string and cio-org-id header
 *
 * @example
 * ```typescript
 * export const load = async ({ cookies, parent }) => {
 *   const { org } = await parent();
 *   const response = await classroomio.organization.$get(
 *     { query: { siteName } },
 *     getApiHeaders(cookies, org?.id)
 *   );
 * };
 * ```
 */
export function getApiHeaders(
  cookies: Cookies,
  orgId?: string
): { headers: { cookie: string; 'cio-org-id'?: string } } {
  const cioCookies = getCioCookieString(cookies);

  const headers: { cookie: string; 'cio-org-id'?: string } = {
    cookie: cioCookies || ''
  };

  console.log('headers', headers);
  console.log('orgId', orgId);

  if (orgId) {
    headers['cio-org-id'] = orgId;
  }

  return { headers };
}
