/**
 * Una empresa hija hereda el dominio de la madre.
 *
 * El caso real: una consultora entrega la plataforma bajo su dominio y sus
 * empresas cliente entran por ahí — no compran un dominio por cliente, y no
 * hace falta, porque el login no está atado al host.
 *
 * Sin herencia, la invitación de una hija cae al dominio raíz del despliegue: la
 * consultora le entrega la plataforma a su cliente con su marca, y el primer
 * mail que el cliente recibe lo manda a la marca de OTRA consultora. Es el mismo
 * problema que ya se arregló para la madre, reapareciendo un nivel más abajo.
 *
 * El borde que fijan estas pruebas es que se hereda el dominio y NO el
 * `siteName`: pisarlo mandaría a madre e hija al mismo lugar.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const orgsById = new Map<string, Record<string, unknown>>();

vi.mock('@cio/db/queries/organization', () => ({
  getOrganizationById: async (id: string) => orgsById.get(id) ?? null
}));

const { resolveOrgUrlIdentity } = await import('@api/utils/org-url');

const CONSULTORA = {
  id: 'consultora-id',
  siteName: 'consultora',
  customDomain: 'learn.consultora-ejemplo.com.ar',
  isCustomDomainVerified: true,
  parentOrganizationId: null
};

const PINTURAS = {
  siteName: 'ferreteria-central',
  customDomain: null,
  isCustomDomainVerified: false,
  parentOrganizationId: 'consultora-id'
};

beforeEach(() => {
  orgsById.clear();
  orgsById.set(CONSULTORA.id, CONSULTORA);
});

describe('resolveOrgUrlIdentity', () => {
  it('la hija sin dominio usa el de la madre', async () => {
    const identity = await resolveOrgUrlIdentity(PINTURAS);

    expect(identity.customDomain).toBe('learn.consultora-ejemplo.com.ar');
    expect(identity.isCustomDomainVerified).toBe(true);
  });

  it('hereda el dominio pero NUNCA el siteName', async () => {
    const identity = await resolveOrgUrlIdentity(PINTURAS);

    expect(identity.siteName).toBe('ferreteria-central');
  });

  it('si la hija tiene el suyo, gana el suyo', async () => {
    const identity = await resolveOrgUrlIdentity({
      ...PINTURAS,
      customDomain: 'learn.pinturas.com.ar',
      isCustomDomainVerified: true
    });

    expect(identity.customDomain).toBe('learn.pinturas.com.ar');
  });

  it('no hereda un dominio de la madre que no esta verificado', async () => {
    orgsById.set(CONSULTORA.id, { ...CONSULTORA, isCustomDomainVerified: false });

    const identity = await resolveOrgUrlIdentity(PINTURAS);

    expect(identity.customDomain).toBeFalsy();
  });

  it('una empresa sin madre se devuelve tal cual', async () => {
    const identity = await resolveOrgUrlIdentity({ ...PINTURAS, parentOrganizationId: null });

    expect(identity.customDomain).toBeFalsy();
    expect(identity.siteName).toBe('ferreteria-central');
  });

  it('aguanta una madre que ya no existe', async () => {
    orgsById.clear();

    await expect(resolveOrgUrlIdentity(PINTURAS)).resolves.toMatchObject({ siteName: 'ferreteria-central' });
  });
});
