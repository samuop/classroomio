import { getOrganizationById } from '@cio/db/queries/organization';
import type { TOrganization } from '@cio/db/types';

/**
 * Con qué marca se presenta una empresa: nombre, logo, color y favicon.
 *
 * Casi siempre es la suya. La excepción es la empresa cliente que la consultora
 * marcó para presentarse con la marca de la consultora (`settings.useParentBrand`):
 * hay clientes cuya política interna no permite que su marca aparezca en una
 * plataforma de terceros. Para su gente, la plataforma, los correos, los
 * certificados y el PDF del curso llevan el nombre, el logo y el color de la
 * consultora.
 *
 * Es una capa de PRESENTACIÓN: la fila de la empresa no se toca. El nombre real
 * sigue sirviendo para que la consultora distinga a sus clientes, y los
 * formularios de configuración siguen editando los datos propios. Si se pisaran
 * los campos de la fila, el primer «Guardar» en la configuración del cliente
 * escribiría el nombre de la consultora encima del suyo.
 *
 * `null` quiere decir «la suya»: quien muestra la empresa usa sus propios campos.
 */
export interface TOrgBrand {
  name: string;
  avatarUrl: string | null;
  theme: string | null;
  favicon: string | null;
}

type TBrandRow = Pick<TOrganization, 'id' | 'name' | 'avatarUrl' | 'theme' | 'favicon' | 'settings' | 'parentOrganizationId'>;

export function usesParentBrand(org: Pick<TBrandRow, 'settings' | 'parentOrganizationId'>): boolean {
  return Boolean(org.parentOrganizationId && org.settings?.useParentBrand);
}

/**
 * La marca prestada, o `null` si la empresa se presenta con la suya.
 *
 * Sólo la madre directa: la jerarquía tiene un nivel (consultora → cliente), y la
 * marca que el cliente toma prestada es la de quien le entrega la formación.
 */
export function brandFor(
  org: Pick<TBrandRow, 'settings' | 'parentOrganizationId'>,
  parent: Pick<TBrandRow, 'id' | 'name' | 'avatarUrl' | 'theme' | 'favicon'> | null | undefined
): TOrgBrand | null {
  if (!usesParentBrand(org) || !parent || parent.id !== org.parentOrganizationId) return null;

  return {
    name: parent.name,
    avatarUrl: parent.avatarUrl ?? null,
    theme: parent.theme ?? null,
    favicon: parent.favicon ?? null
  };
}

/**
 * Le agrega `brand` a cada empresa de una lista, para el dashboard.
 *
 * La madre se busca una sola vez aunque tenga varios clientes en la lista, y si
 * ya viene en la lista (la consultora que mira a sus clientes) no se busca.
 */
export async function attachOrgBrands<T extends TBrandRow>(orgs: T[]): Promise<Array<T & { brand: TOrgBrand | null }>> {
  const enLaLista = new Map<string, TBrandRow>(orgs.map((org) => [org.id, org]));
  const madres = new Map<string, TBrandRow>();

  for (const org of orgs) {
    const madreId = org.parentOrganizationId;
    if (!usesParentBrand(org) || !madreId || madres.has(madreId)) continue;

    const madre = enLaLista.get(madreId) ?? (await getOrganizationById(madreId));
    if (madre) madres.set(madreId, madre);
  }

  return orgs.map((org) => ({ ...org, brand: brandFor(org, madres.get(org.parentOrganizationId ?? '')) }));
}

/**
 * Lo mismo para una empresa de la que sólo se tiene el id: correos,
 * certificados, el PDF del curso, las vistas previas de una invitación.
 *
 * Caché de diez minutos, como la firma de los correos (ver `sender-name.ts`): un
 * envío masivo a 40 alumnos hace una sola consulta. Cambiar el ajuste la vacía
 * (`clearOrgBrandCache`), así que el cambio llega al instante.
 */
const CACHE_TTL_MS = 10 * 60 * 1000;

const cache = new Map<string, { brand: TOrgBrand | null; vence: number }>();

export function clearOrgBrandCache(): void {
  cache.clear();
}

export async function resolveOrgBrand(orgId: string | null | undefined): Promise<TOrgBrand | null> {
  if (!orgId) return null;

  const enCache = cache.get(orgId);
  if (enCache && enCache.vence > Date.now()) return enCache.brand;

  try {
    const org = await getOrganizationById(orgId);
    const madre = org && usesParentBrand(org) ? await getOrganizationById(org.parentOrganizationId!) : null;
    const brand = org ? brandFor(org, madre) : null;

    cache.set(orgId, { brand, vence: Date.now() + CACHE_TTL_MS });

    return brand;
  } catch (error) {
    // No se cachea el fallo: un hipo de la base no puede dejar diez minutos al
    // cliente mostrando su marca. Esto corre dentro de envíos y descargas, así
    // que no puede tumbarlos.
    console.error(`resolveOrgBrand(${orgId}) falló; se muestra la marca propia:`, error);

    return null;
  }
}

/** El nombre con que se presenta la empresa: el prestado si lo tiene, si no el suyo. */
export async function resolveOrgDisplayName(orgId: string | null | undefined, ownName: string): Promise<string> {
  return (await resolveOrgBrand(orgId))?.name ?? ownName;
}
