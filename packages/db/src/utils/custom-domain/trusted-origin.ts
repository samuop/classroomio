import { BRAND_ROOT_DOMAIN, TENANT_ROOT_DOMAIN } from '@cio/utils/constants';
import { TRUSTED_ORIGINS } from '../../constants';
import { getVerifiedCustomDomainHostnames } from '../../queries/organization/organization';

const FIRST_PARTY_ROOTS: readonly string[] = [BRAND_ROOT_DOMAIN, TENANT_ROOT_DOMAIN];

/** Lowercase hostnames with verified custom domains ( warmed at API boot + updated on domain routes ). */
const verifiedCustomDomainHostnames = new Set<string>();

function originMatchesStaticEntry(origin: string, entry: string): boolean {
  const trimmedEntry = entry.trim();

  if (!trimmedEntry.includes('*')) {
    return origin === trimmedEntry;
  }

  const regex = new RegExp(
    `^${trimmedEntry
      .split('*')
      .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
      .join('.*')}$`
  );

  return regex.test(origin);
}

function isClassroomioHost(hostname: string): boolean {
  const host = hostname.toLowerCase();

  return FIRST_PARTY_ROOTS.some((root) => host === root || host.endsWith(`.${root}`));
}

export function trustCustomDomainHostname(hostname: string): void {
  const normalized = hostname.trim().toLowerCase();

  if (normalized) {
    verifiedCustomDomainHostnames.add(normalized);
  }
}

export function untrustCustomDomainHostname(hostname: string): void {
  verifiedCustomDomainHostnames.delete(hostname.trim().toLowerCase());
}

export async function preloadVerifiedCustomDomainOrigins(): Promise<void> {
  const hostnames = await getVerifiedCustomDomainHostnames();

  verifiedCustomDomainHostnames.clear();

  for (const hostname of hostnames) {
    verifiedCustomDomainHostnames.add(hostname);
  }
}

/**
 * Resolves whether a browser `Origin` header value is allowed for CORS / Better Auth.
 * `staticTrustedOriginEntries` may include exact origins or `*` patterns (e.g. https://*.classroomio.com).
 */
export function resolveTrustedBrowserOrigin(
  origin: string | undefined | null,
  staticTrustedOriginEntries: readonly string[]
): string | undefined {
  if (!origin || origin === 'null') {
    return undefined;
  }

  let parsed: URL;

  try {
    parsed = new URL(origin);
  } catch {
    return undefined;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return undefined;
  }

  for (const entry of staticTrustedOriginEntries) {
    if (originMatchesStaticEntry(origin, entry)) {
      return origin;
    }
  }

  const hostname = parsed.hostname;

  if (isClassroomioHost(hostname)) {
    return origin;
  }

  if (verifiedCustomDomainHostnames.has(hostname.toLowerCase())) {
    return origin;
  }

  return undefined;
}

/**
 * Todos los origenes que Better Auth acepta como destino de un `callbackURL`.
 *
 * Hay que armar la lista entera y no alcanza con resolver la cabecera `Origin`,
 * porque **el enlace de un correo no trae esa cabecera**: hacer clic desde la
 * bandeja de entrada es una navegacion de primer nivel, sin `Origin`. Ahi
 * `resolveTrustedBrowserOrigin` no tenia nada que resolver, y el dominio propio
 * del cliente —verificado, y ya aceptado para CORS— quedaba afuera.
 *
 * El sintoma era desconcertante porque la mitad del camino funcionaba: pedir el
 * correo desde `learn.<cliente>.com` andaba (el navegador manda `Origin`) y el
 * correo llegaba, pero el enlace de ese correo moria en 403
 * `INVALID_CALLBACK_URL`. La persona veia "te mandamos el enlace" y despues un
 * enlace roto, sin nada que relacionara las dos cosas.
 *
 * Los hosts de primera parte se agregan como comodin por el mismo motivo: sin
 * `Origin`, `isClassroomioHost` tampoco se consultaba, asi que un tenant en
 * `<empresa>.<raiz>` chocaba contra la misma pared. Que un camino los acepte y
 * el otro no era la asimetria de fondo.
 */
export function buildTrustedOrigins(originHeader?: string | null): string[] {
  const origins = new Set<string>(TRUSTED_ORIGINS);

  for (const root of new Set(FIRST_PARTY_ROOTS)) {
    origins.add(`https://${root}`);
    origins.add(`https://*.${root}`);
  }

  // Un dominio propio se agrega EXACTO, nunca como comodin: verificar
  // `learn.cliente.com` no dice nada sobre `cualquiera.cliente.com`.
  for (const hostname of verifiedCustomDomainHostnames) {
    origins.add(`https://${hostname}`);
  }

  const resolved = resolveTrustedBrowserOrigin(originHeader, TRUSTED_ORIGINS);

  if (resolved) {
    origins.add(resolved);
  }

  return [...origins];
}
