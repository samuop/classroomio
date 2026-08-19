import { env } from './env';

/**
 * Lo mínimo que hace falta saber de una empresa para armarle una URL.
 *
 * Es la fila de `organization` recortada, para que el que llama pueda pasar la
 * que ya tiene en la mano sin ir a buscar nada.
 */
export interface TOrgUrlIdentity {
  siteName?: string | null;
  customDomain?: string | null;
  isCustomDomainVerified?: boolean | null;
}

function normalizeOrigin(value: string): string {
  const trimmed = value.trim().replace(/\/$/, '');

  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

/**
 * La URL base del dashboard: invitaciones, links de mails, etc.
 *
 * ── Por qué el dominio propio gana ───────────────────────────────────────────
 *
 * Una consultora que le entrega la plataforma a un cliente le da un dominio
 * propio (`learn.egeaconsultoria.com.ar`). Si la invitación del equipo de ESE
 * cliente apunta al dominio de la consultora, la persona invitada aterriza en
 * una marca que no es la suya — y encima en un host distinto, donde su sesión
 * no vale, porque las cookies son por host.
 *
 * Antes `DASHBOARD_ORIGIN` cortaba primero y el parámetro de empresa se
 * descartaba: TODA invitación salía apuntando al dominio raíz del despliegue.
 * Ahora un dominio propio **verificado** manda sobre él. Tiene que estar
 * verificado: un dominio a medio configurar manda a la gente a un host que no
 * resuelve, y eso es peor que mandarla al dominio principal.
 *
 * En desarrollo se saltea: si la base local tiene una fila con dominio propio,
 * los links de prueba se irían a producción.
 */
export function getDashboardBaseUrl(org?: string | TOrgUrlIdentity): string {
  const identity: TOrgUrlIdentity = typeof org === 'string' ? { siteName: org } : (org ?? {});
  const isDevelopment = env.NODE_ENV === 'development';

  if (!isDevelopment && identity.isCustomDomainVerified && identity.customDomain?.trim()) {
    return normalizeOrigin(identity.customDomain);
  }

  if (env.DASHBOARD_ORIGIN) {
    return normalizeOrigin(env.DASHBOARD_ORIGIN);
  }

  if (isDevelopment) {
    return 'http://localhost:5173';
  }

  const subdomain = identity.siteName || 'app';

  return `https://${subdomain}.classroomio.com`;
}
