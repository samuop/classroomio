import { getOrganizationById, getOrganizationBySiteName } from '@cio/db/queries/organization';
import type { TOrgUrlIdentity } from '@api/config/dashboard-url';

interface TOrgWithParent extends TOrgUrlIdentity {
  parentOrganizationId?: string | null;
}

/**
 * Con que dominio se le habla a la gente de una empresa.
 *
 * Una empresa hija hereda el dominio de la madre cuando no tiene el propio.
 *
 * ── Por que ──────────────────────────────────────────────────────────────────
 *
 * Una consultora entrega la plataforma bajo su dominio y sus empresas cliente
 * entran por ahi: no compran un dominio por cliente, y no hace falta — el login
 * no esta atado al host, cada persona aterriza en su empresa igual.
 *
 * Sin esto, la invitacion de una hija sale apuntando al dominio raiz del
 * despliegue: la consultora le entrega la plataforma a su cliente con su marca,
 * y el primer mail que recibe el cliente lo manda a la marca de OTRA consultora.
 * Es el mismo problema que ya se arreglo para la empresa madre, aparecido un
 * nivel mas abajo.
 *
 * Solo se hereda el dominio, nunca el `siteName`: el subdominio de la hija es
 * suyo, y pisarlo con el de la madre mandaria a los dos lados al mismo lugar.
 */
export async function resolveOrgUrlIdentity(org: TOrgWithParent): Promise<TOrgUrlIdentity> {
  const hasOwnDomain = Boolean(org.isCustomDomainVerified && org.customDomain?.trim());

  if (hasOwnDomain || !org.parentOrganizationId) {
    return org;
  }

  const parent = await getOrganizationById(org.parentOrganizationId);

  if (!parent?.isCustomDomainVerified || !parent.customDomain?.trim()) {
    return org;
  }

  return {
    siteName: org.siteName,
    customDomain: parent.customDomain,
    isCustomDomainVerified: true
  };
}

/**
 * Lo mismo, pero cuando lo unico que se tiene a mano es el nombre del sitio.
 *
 * Los caminos de invitacion a un CURSO arrastran el `orgSiteName` como texto a
 * traves de varias capas, no la fila de la empresa. Sin esta busqueda, el link
 * para inscribirse cae al dominio raiz del despliegue: el alumno de una empresa
 * cliente recibe el mail de su empresa y el boton lo manda a la marca de la
 * consultora que le vendio la plataforma a SU consultora.
 */
export async function resolveOrgUrlIdentityBySiteName(siteName?: string | null): Promise<TOrgUrlIdentity> {
  if (!siteName) return {};

  const org = await getOrganizationBySiteName(siteName);

  if (!org) return { siteName };

  return resolveOrgUrlIdentity(org);
}
