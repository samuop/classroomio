/**
 * Tenant/brand root domains.
 *
 * Configurable via env vars so a self-hosted / white-label deployment
 * (e.g. tensor.com.ar) can serve tenant sites as `<orgSiteName>.<root>`
 * without code changes — set the vars in `.env`, not here.
 *
 * `@cio/utils` is isomorphic: imported by server code (api, db — plain Node) AND
 * browser code (dashboard, ui, website — bundled by Vite). No single env source
 * covers both, so each value is read from two, taking whichever is present:
 *  - `import.meta.env.PUBLIC_*` — Vite statically replaces these LITERAL member
 *    expressions in the client bundle (requires `envPrefix` to include `PUBLIC_`,
 *    set in the dashboard/website vite configs). Undefined under plain Node.
 *  - `process.env.PUBLIC_*` — the real environment on the server.
 *
 * IMPORTANT: keep them as the literal `import.meta.env.PUBLIC_NAME` /
 * `process.env.PUBLIC_NAME` member expressions — Vite only replaces the static
 * literal form, so a dynamic `[key]` lookup returns undefined and the browser
 * would fall back to the cloud default. The `safe()` wrappers keep a runtime that
 * has neither global from throwing.
 */

// Ambient decls so TS accepts these reads without @types/node or vite/client
// (keeps the package environment-agnostic).
declare const process: { env: Record<string, string | undefined> };

function safe(read: () => string | undefined): string | undefined {
  try {
    return read();
  } catch {
    return undefined;
  }
}

function pick(fallback: string, ...values: Array<string | undefined>): string {
  for (const value of values) {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    if (trimmed.length > 0) return trimmed;
  }

  return fallback;
}

/**
 * The apex that hosts every tenant site as `<orgSiteName>.<TENANT_ROOT_DOMAIN>`.
 * Cloud default is `myclassroomio.com`; override with PUBLIC_TENANT_ROOT_DOMAIN
 * (e.g. `tensor.com.ar`). A wildcard DNS record `*.<root>` must point at the
 * dashboard for these subdomains to resolve.
 */
export const TENANT_ROOT_DOMAIN = pick(
  'myclassroomio.com',
  safe(() => (import.meta as unknown as { env: Record<string, string | undefined> }).env.PUBLIC_TENANT_ROOT_DOMAIN),
  safe(() => process.env.PUBLIC_TENANT_ROOT_DOMAIN)
);

/**
 * The marketing / admin / api zone. Override with PUBLIC_BRAND_ROOT_DOMAIN.
 * Falls back to the tenant root so single-domain deployments need set only one.
 */
export const BRAND_ROOT_DOMAIN = pick(
  TENANT_ROOT_DOMAIN,
  safe(() => (import.meta as unknown as { env: Record<string, string | undefined> }).env.PUBLIC_BRAND_ROOT_DOMAIN),
  safe(() => process.env.PUBLIC_BRAND_ROOT_DOMAIN)
);
