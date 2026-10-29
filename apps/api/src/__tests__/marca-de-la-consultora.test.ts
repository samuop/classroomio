/**
 * El cliente que se presenta con la marca de su consultora.
 *
 * Hay clientes cuya política interna no permite que su marca aparezca en una
 * plataforma de terceros. La consultora los marca (`settings.useParentBrand`) y
 * desde ahí su gente ve el nombre, el logo y el color de la consultora — también
 * en los correos, que es donde el nombre del cliente más se lee.
 *
 * Lo que se cuida acá:
 * - la regla sale del ajuste Y de tener madre; una empresa sin madre no tiene de
 *   quién tomar prestado;
 * - el correo encolado ya no nombra al cliente (se mira lo que se ENCOLA, no lo
 *   que devuelve el resolvedor: lo que se rompe es aplicarlo);
 * - el ajuste lo cambia la consultora desde su empresa principal, nunca el
 *   cliente desde la suya.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getOrganizationById = vi.fn();
const updateOrganization = vi.fn();
const enqueueEmailSend = vi.fn(async () => 'job-1');
const resolveEmailOverride = vi.fn(async () => null);
const getAccountPrimary = vi.fn();
const listWorkspacesForAccount = vi.fn();

vi.mock('@cio/db/queries/organization', () => ({
  getOrganizationById: (...args: unknown[]) => getOrganizationById(...(args as [])),
  updateOrganization: (...args: unknown[]) => updateOrganization(...(args as [])),
  getRootOrganizationName: vi.fn(async () => 'Consultora Norte'),
  getOrgNotificationSettings: vi.fn(),
  checkSiteNameExists: vi.fn()
}));

vi.mock('@cio/db/queries/account', () => ({
  getAccountPrimary: (...args: unknown[]) => getAccountPrimary(...(args as [])),
  listWorkspacesForAccount: (...args: unknown[]) => listWorkspacesForAccount(...(args as [])),
  countWorkspacesForAccount: vi.fn(),
  createSecondaryWorkspace: vi.fn(),
  deleteSecondaryWorkspace: vi.fn(),
  getActivePlanForPrimary: vi.fn()
}));

vi.mock('@cio/jobs', () => ({
  enqueueEmailSend: (...args: unknown[]) => enqueueEmailSend(...(args as [])),
  isRedisConfigured: () => true
}));

vi.mock('@api/services/organization/email-template', () => ({
  resolveEmailOverride: (...args: unknown[]) => resolveEmailOverride(...(args as []))
}));

vi.mock('@api/utils/redis/redis', () => ({ logRedisUnavailableOnce: vi.fn() }));

const { attachOrgBrands, brandFor, clearOrgBrandCache, resolveOrgBrand } = await import(
  '@api/services/organization/org-brand'
);
const { enqueueTransactionalEmail } = await import('@api/services/jobs/email-jobs');
const { setWorkspaceParentBrand } = await import('@api/services/account/workspaces');

const CONSULTORA = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Consultora Norte',
  avatarUrl: 'https://archivos.ejemplo.test/logo-consultora.png',
  theme: 'purple',
  favicon: 'https://archivos.ejemplo.test/favicon-consultora.png',
  settings: {},
  parentOrganizationId: null
};

const CLIENTE_SIN_MARCA = {
  id: '00000000-0000-4000-8000-000000000002',
  name: 'Cliente Reservado',
  avatarUrl: 'https://archivos.ejemplo.test/logo-cliente.png',
  theme: '#585b0d',
  favicon: null,
  settings: { useParentBrand: true },
  parentOrganizationId: CONSULTORA.id
};

const CLIENTE_CON_MARCA = {
  ...CLIENTE_SIN_MARCA,
  id: '00000000-0000-4000-8000-000000000003',
  name: 'Cliente Común',
  settings: {}
};

const porId = new Map<string, unknown>([CONSULTORA, CLIENTE_SIN_MARCA, CLIENTE_CON_MARCA].map((org) => [org.id, org]));

beforeEach(() => {
  vi.clearAllMocks();
  clearOrgBrandCache();
  getOrganizationById.mockImplementation(async (id: string) => porId.get(id) ?? null);
  resolveEmailOverride.mockResolvedValue(null);
});

describe('brandFor', () => {
  it('el cliente marcado toma nombre, logo, color y favicon de la consultora', () => {
    expect(brandFor(CLIENTE_SIN_MARCA, CONSULTORA)).toEqual({
      name: 'Consultora Norte',
      avatarUrl: CONSULTORA.avatarUrl,
      theme: 'purple',
      favicon: CONSULTORA.favicon
    });
  });

  it('el cliente sin el ajuste se presenta con la suya', () => {
    expect(brandFor(CLIENTE_CON_MARCA, CONSULTORA)).toBeNull();
    expect(brandFor({ ...CLIENTE_SIN_MARCA, settings: { useParentBrand: false } }, CONSULTORA)).toBeNull();
    expect(brandFor({ ...CLIENTE_SIN_MARCA, settings: null }, CONSULTORA)).toBeNull();
  });

  it('una empresa sin madre no tiene de quién tomarla, aunque tenga el ajuste', () => {
    expect(brandFor({ ...CONSULTORA, settings: { useParentBrand: true } }, CONSULTORA)).toBeNull();
  });

  it('no toma la marca de una empresa que no es su madre', () => {
    expect(brandFor(CLIENTE_SIN_MARCA, { ...CONSULTORA, id: '00000000-0000-4000-8000-000000000009' })).toBeNull();
    expect(brandFor(CLIENTE_SIN_MARCA, null)).toBeNull();
  });

  it('la consultora sin logo ni favicon presta los vacíos, no el logo del cliente', () => {
    const brand = brandFor(CLIENTE_SIN_MARCA, { ...CONSULTORA, avatarUrl: null, favicon: null });

    expect(brand?.avatarUrl).toBeNull();
    expect(brand?.favicon).toBeNull();
  });
});

describe('attachOrgBrands', () => {
  it('a la lista del alumno del cliente le agrega la marca, buscando a la madre que no está en la lista', async () => {
    const [cliente] = await attachOrgBrands([CLIENTE_SIN_MARCA]);

    expect(cliente.brand?.name).toBe('Consultora Norte');
    // Los datos reales no se tocan: los formularios de configuración los editan.
    expect(cliente.name).toBe('Cliente Reservado');
    expect(cliente.avatarUrl).toBe(CLIENTE_SIN_MARCA.avatarUrl);
    expect(getOrganizationById).toHaveBeenCalledTimes(1);
  });

  it('si la madre ya viene en la lista no la busca, y los demás quedan con la suya', async () => {
    const lista = await attachOrgBrands([CONSULTORA, CLIENTE_SIN_MARCA, CLIENTE_CON_MARCA]);

    expect(lista.map((org) => org.brand?.name ?? null)).toEqual([null, 'Consultora Norte', null]);
    expect(getOrganizationById).not.toHaveBeenCalled();
  });
});

describe('resolveOrgBrand', () => {
  it('un fallo de la base no se cachea', async () => {
    getOrganizationById.mockRejectedValueOnce(new Error('se cortó'));

    await expect(resolveOrgBrand(CLIENTE_SIN_MARCA.id)).resolves.toBeNull();
    await expect(resolveOrgBrand(CLIENTE_SIN_MARCA.id)).resolves.toMatchObject({ name: 'Consultora Norte' });
  });
});

describe('correos del cliente marcado', () => {
  async function encolarInvitacion(orgId: string) {
    await enqueueTransactionalEmail('studentCourseInvite', {
      to: 'alumna@ejemplo.test',
      fields: {
        courseName: 'Rutinas de caja',
        orgName: 'Cliente Reservado',
        inviteLink: 'https://learn.ejemplo.test/invite',
        expiresAt: '30/10/2026'
      },
      orgId
    });

    return enqueueEmailSend.mock.calls.at(-1)?.[0] as { fields?: { orgName?: string } } | undefined;
  }

  it('la invitación encolada nombra a la consultora, no al cliente', async () => {
    const encolado = await encolarInvitacion(CLIENTE_SIN_MARCA.id);

    expect(encolado?.fields?.orgName).toBe('Consultora Norte');
    expect(JSON.stringify(encolado)).not.toContain('Cliente Reservado');
  });

  it('el texto reescrito por la consultora también recibe el nombre prestado', async () => {
    await encolarInvitacion(CLIENTE_SIN_MARCA.id);

    const campos = resolveEmailOverride.mock.calls.at(-1)?.[2] as { orgName?: string } | undefined;
    expect(campos?.orgName).toBe('Consultora Norte');
  });

  it('el cliente sin el ajuste sigue nombrado con lo suyo', async () => {
    await enqueueTransactionalEmail('studentCourseInvite', {
      to: 'alumna@ejemplo.test',
      fields: {
        courseName: 'Rutinas de caja',
        orgName: 'Cliente Común',
        inviteLink: 'https://learn.ejemplo.test/invite',
        expiresAt: '30/10/2026'
      },
      orgId: CLIENTE_CON_MARCA.id
    });

    const encolado = enqueueEmailSend.mock.calls.at(-1)?.[0] as { fields?: { orgName?: string } };
    expect(encolado.fields?.orgName).toBe('Cliente Común');
  });
});

describe('setWorkspaceParentBrand', () => {
  beforeEach(() => {
    listWorkspacesForAccount.mockResolvedValue([CONSULTORA, CLIENTE_SIN_MARCA, CLIENTE_CON_MARCA]);
    updateOrganization.mockImplementation(async (id: string, data: { settings: object }) => ({
      ...(porId.get(id) as object),
      settings: data.settings
    }));
  });

  it('la consultora lo cambia desde su empresa principal', async () => {
    getAccountPrimary.mockResolvedValue(CONSULTORA);

    const actualizado = await setWorkspaceParentBrand(CONSULTORA.id, CLIENTE_CON_MARCA.id, true);

    expect(updateOrganization).toHaveBeenCalledWith(CLIENTE_CON_MARCA.id, { settings: { useParentBrand: true } });
    expect(actualizado.isPrimary).toBe(false);
  });

  it('desde dentro del cliente no se puede: 403', async () => {
    getAccountPrimary.mockResolvedValue(CONSULTORA);

    await expect(setWorkspaceParentBrand(CLIENTE_SIN_MARCA.id, CLIENTE_SIN_MARCA.id, false)).rejects.toMatchObject({
      statusCode: 403
    });
    expect(updateOrganization).not.toHaveBeenCalled();
  });

  it('una empresa que no es cliente de esta cuenta: 404', async () => {
    getAccountPrimary.mockResolvedValue(CONSULTORA);

    await expect(
      setWorkspaceParentBrand(CONSULTORA.id, '00000000-0000-4000-8000-000000000099', true)
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(updateOrganization).not.toHaveBeenCalled();
  });

  it('la empresa principal no puede tomar prestada ninguna marca', async () => {
    getAccountPrimary.mockResolvedValue(CONSULTORA);

    await expect(setWorkspaceParentBrand(CONSULTORA.id, CONSULTORA.id, true)).rejects.toMatchObject({
      statusCode: 400
    });
  });

  it('el cambio se ve enseguida, sin esperar la caché', async () => {
    getAccountPrimary.mockResolvedValue(CONSULTORA);
    await expect(resolveOrgBrand(CLIENTE_CON_MARCA.id)).resolves.toBeNull();

    porId.set(CLIENTE_CON_MARCA.id, { ...CLIENTE_CON_MARCA, settings: { useParentBrand: true } });
    await setWorkspaceParentBrand(CONSULTORA.id, CLIENTE_CON_MARCA.id, true);

    await expect(resolveOrgBrand(CLIENTE_CON_MARCA.id)).resolves.toMatchObject({ name: 'Consultora Norte' });
    porId.set(CLIENTE_CON_MARCA.id, CLIENTE_CON_MARCA);
  });
});
