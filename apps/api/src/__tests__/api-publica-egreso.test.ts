/**
 * La API pública para Seguimiento (SaaS-RRHH, fase 23): sacar a un alumno de la organización por su
 * correo exacto, cuando egresa.
 *
 * Antes había que buscarlo con `GET /audience?search=`, que compara por parecido (`%…%`, y el `_` es
 * comodín) y deja el correo en la dirección (y en los registros), y después borrarlo por su `memberId`.
 * Contra Postgres: egreso-del-campus.int.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getOrganizationStudentsByEmails = vi.fn();
const deleteOrganizationAudienceMember = vi.fn();
const revokeActiveOrganizationInvitesByEmails = vi.fn();

vi.mock('@cio/db/queries/organization', () => ({
  getOrganizationStudentsByEmails: (...a: unknown[]) => getOrganizationStudentsByEmails(...a),
  deleteOrganizationAudienceMember: (...a: unknown[]) => deleteOrganizationAudienceMember(...a),
  revokeActiveOrganizationInvitesByEmails: (...a: unknown[]) => revokeActiveOrganizationInvitesByEmails(...a)
}));
vi.mock('@api/services/organization/audience', () => ({
  importAudienceMembers: vi.fn(),
  assignAudienceToCourses: vi.fn(),
  updatePendingAudienceMemberEmail: vi.fn()
}));
vi.mock('@api/services/organization', () => ({
  getOrgAudience: vi.fn(),
  getOrgAudienceMember: vi.fn(),
  removeAudienceMember: vi.fn()
}));

const { removeAudienceByEmailService } = await import('@api/services/v1/audience');
const { ZPublicApiRemoveAudience } = await import('@cio/utils/validation/public-api');

const ORG = '11111111-1111-4111-8111-111111111111';
const ACTOR = '22222222-2222-4222-8222-222222222222';

beforeEach(() => {
  vi.clearAllMocks();
  getOrganizationStudentsByEmails.mockResolvedValue([]);
  deleteOrganizationAudienceMember.mockImplementation(async (_org: string, memberId: number) => ({ id: memberId }));
  revokeActiveOrganizationInvitesByEmails.mockResolvedValue([]);
});

describe('el contrato', () => {
  it('un correo, en el cuerpo; sin espacios de más', () => {
    expect(ZPublicApiRemoveAudience.parse({ email: ' ana@invalid.local ' })).toEqual({ email: 'ana@invalid.local' });
    expect(ZPublicApiRemoveAudience.safeParse({ email: '' }).success).toBe(false);
    expect(ZPublicApiRemoveAudience.safeParse({}).success).toBe(false);
    expect(ZPublicApiRemoveAudience.safeParse({ email: `${'a'.repeat(320)}@x` }).success).toBe(false);
  });
});

describe('sacar por correo', () => {
  it('saca a los alumnos con ese correo exacto y le revoca las invitaciones sin aceptar', async () => {
    getOrganizationStudentsByEmails.mockResolvedValue([{ memberId: 7, profileId: 'p', email: 'ana@invalid.local' }]);
    revokeActiveOrganizationInvitesByEmails.mockResolvedValue([{ id: 'i1' }]);

    expect(await removeAudienceByEmailService(ORG, ACTOR, 'Ana@Invalid.local ')).toEqual({
      removed: 1,
      invitesRevoked: 1
    });
    expect(getOrganizationStudentsByEmails).toHaveBeenCalledWith(ORG, ['ana@invalid.local']);
    expect(deleteOrganizationAudienceMember).toHaveBeenCalledWith(ORG, 7);
    expect(revokeActiveOrganizationInvitesByEmails).toHaveBeenCalledWith(ORG, ['ana@invalid.local'], ACTOR);
  });

  it('si no estaba no es un error, y una invitación suelta igual se revoca', async () => {
    expect(await removeAudienceByEmailService(ORG, ACTOR, 'nadie@invalid.local')).toEqual({
      removed: 0,
      invitesRevoked: 0
    });
    expect(deleteOrganizationAudienceMember).not.toHaveBeenCalled();
    expect(revokeActiveOrganizationInvitesByEmails).toHaveBeenCalledWith(ORG, ['nadie@invalid.local'], ACTOR);
  });

  it('sin quien firme la clave, no', async () => {
    await expect(removeAudienceByEmailService(ORG, null, 'ana@invalid.local')).rejects.toMatchObject({
      statusCode: 401
    });
    expect(getOrganizationStudentsByEmails).not.toHaveBeenCalled();
  });
});
