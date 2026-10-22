/**
 * El registro sólo por invitación, en una cuenta con empresas hijas.
 *
 * Una consultora y sus empresas cliente comparten el dominio de la consultora,
 * y la pantalla de registro manda en `cio-org-id` la empresa que tenga a mano:
 * la del cliente si se llegó desde la invitación, la dueña del dominio si la
 * pantalla se recargó. El guardia buscaba la invitación SÓLO en esa empresa, así
 * que con la consultora en «sólo por invitación» un alumno invitado al cliente
 * quedaba afuera por recargar. Ahora la invitación vale si es de cualquier
 * empresa de la cuenta — y sin invitación, nadie se registra.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  getOrganizationById: vi.fn(),
  hasActiveOrganizationInviteForEmailInAccount: vi.fn()
}));

vi.mock('@cio/db/queries/organization', () => ({
  checkEmailExistsInOrg: vi.fn(),
  getFirstOrganization: vi.fn(),
  getOrganizationById: db.getOrganizationById,
  hasActiveOrganizationInviteForEmailInAccount: db.hasActiveOrganizationInviteForEmailInAccount
}));

vi.mock('@api/config/env', () => ({ env: { PUBLIC_IS_SELFHOSTED: 'false' } }));

const { signupGuard } = await import('@api/middlewares/signup-guard');
const { Hono } = await import('hono');

const CONSULTORA = { id: 'org-consultora', parentOrganizationId: null };
const CLIENTE = { id: 'org-cliente', parentOrganizationId: 'org-consultora' };

const soloInvitacion = (org: { id: string; parentOrganizationId: string | null }) => ({
  ...org,
  disableSignup: false,
  settings: { signup: { inviteOnly: true } }
});

async function registrar(orgId: string | undefined, email = 'ana@ejemplo.test') {
  const app = new Hono().post('/api/auth/sign-up/email', signupGuard, (c) => c.json({ ok: true }));

  const respuesta = await app.request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(orgId ? { 'cio-org-id': orgId } : {}) },
    body: JSON.stringify({ email, password: 'x', name: 'ana' })
  });

  return { status: respuesta.status, cuerpo: await respuesta.json() };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('registro sólo por invitación', () => {
  it('un invitado al cliente se registra aunque la pantalla mande la consultora (recargó)', async () => {
    db.getOrganizationById.mockResolvedValue(soloInvitacion(CONSULTORA));
    db.hasActiveOrganizationInviteForEmailInAccount.mockResolvedValue(true);

    const { status } = await registrar(CONSULTORA.id);

    expect(status).toBe(200);
    expect(db.hasActiveOrganizationInviteForEmailInAccount).toHaveBeenCalledWith('org-consultora', 'ana@ejemplo.test');
  });

  it('desde la empresa cliente, la invitación se busca en toda la cuenta de su consultora', async () => {
    db.getOrganizationById.mockResolvedValue(soloInvitacion(CLIENTE));
    db.hasActiveOrganizationInviteForEmailInAccount.mockResolvedValue(true);

    const { status } = await registrar(CLIENTE.id, 'ANA@ejemplo.test');

    expect(status).toBe(200);
    expect(db.hasActiveOrganizationInviteForEmailInAccount).toHaveBeenCalledWith('org-consultora', 'ana@ejemplo.test');
  });

  it('sin invitación vigente en la cuenta, no se registra', async () => {
    db.getOrganizationById.mockResolvedValue(soloInvitacion(CONSULTORA));
    db.hasActiveOrganizationInviteForEmailInAccount.mockResolvedValue(false);

    const { status, cuerpo } = await registrar(CONSULTORA.id);

    expect(status).toBe(403);
    expect(cuerpo).toMatchObject({ code: 'INVITE_REQUIRED' });
  });

  it('una empresa con registro abierto no pide invitación', async () => {
    db.getOrganizationById.mockResolvedValue({ ...CONSULTORA, disableSignup: false, settings: {} });

    const { status } = await registrar(CONSULTORA.id);

    expect(status).toBe(200);
    expect(db.hasActiveOrganizationInviteForEmailInAccount).not.toHaveBeenCalled();
  });
});
