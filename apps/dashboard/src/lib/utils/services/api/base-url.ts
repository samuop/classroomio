/**
 * Dónde vive la API según quién pregunta.
 *
 * Vive en su propio módulo —y no en `index.ts`, donde estaba— porque el
 * reportador de incidencias también lo necesita, y `index.ts` importa al
 * reportador: dejarlo allá armaba un ciclo de imports entre los dos.
 */

import { dev } from '$app/environment';
import { env } from '$env/dynamic/public';

export const getRequestBaseUrl = () => {
  if (typeof window === 'undefined') {
    // When on the server, we want to hit the private url which is the docker container of `api` or the private network url of `api`.
    // if that isn't set then it will fallback to the public url of the `api`
    return process.env.PRIVATE_SERVER_URL || env.PUBLIC_SERVER_URL;
  }

  // Self-hosted: dashboard and API are on different subdomains of the
  // operator's apex. Browser calls go straight to PUBLIC_SERVER_URL;
  // cookies cross subdomains via AUTH_COOKIE_DOMAIN. No Worker proxy.
  if (env.PUBLIC_IS_SELFHOSTED === 'true' || dev) {
    return env.PUBLIC_SERVER_URL ?? '';
  }

  // Cloud (multi-tenant): same-origin via the Cloudflare Worker `/proxy`
  // prefix so auth cookies stay host-only on whichever tenant or BYOD
  // domain the user is currently visiting. The Worker strips `/proxy` before forwarding to the API
  return `${window.location.origin}/proxy`;
};
