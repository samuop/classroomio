/**
 * Volver a importar alumnos no puede romper las invitaciones que ya salieron.
 *
 * Importar a alguien que ya estaba pendiente RENOVABA su invitación: revocaba la
 * vigente y mandaba otra. Con una lista pegada dos veces —o reenviada sola por
 * el navegador después de un corte— cada persona recibía dos correos y el link
 * del primero decía «revocada». Ahora una invitación vigente que ya cubre lo que
 * se pide se deja como está; se renueva sólo la vencida o la que no incluye el
 * curso nuevo.
 *
 * Y los dos rechazos de la lista entera (un correo mal escrito, un correo del
 * equipo) viajan con su código y los correos culpables, que es con lo que el
 * dashboard le dice a la docente cuál corregir.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ROLE } from '@cio/utils/constants';

const db = vi.hoisted(() => ({
  getOrganizationById: vi.fn(),
  getOrganizationMembersByNormalizedEmails: vi.fn(),
  getActiveOrganizationInvitesByEmails: vi.fn(),
  revokeActiveOrganizationInvitesByEmails: vi.fn(),
  createOrganizationInvites: vi.fn(),
  createOrganizationInviteAudits: vi.fn(),
  createOrganizationMembers: vi.fn(),
  getOrgCourses: vi.fn(),
  getCourseGroupIds: vi.fn(),
  getProfilesByEmails: vi.fn(),
  enqueueTransactionalEmail: vi.fn()
}));

vi.mock('@cio/db/queries/organization', () => ({
  createOrganizationInvite: vi.fn(),
  createOrganizationInviteAudits: db.createOrganizationInviteAudits,
  createOrganizationInvites: db.createOrganizationInvites,
  createOrganizationMembers: db.createOrganizationMembers,
  getActiveOrganizationInvitesByEmails: db.getActiveOrganizationInvitesByEmails,
  getOrganizationAudienceMember: vi.fn(),
  getLatestOrganizationInviteRowByOrgAndEmail: vi.fn(),
  getOrgMembersByProfileIds: vi.fn(async () => []),
  getOrganizationById: db.getOrganizationById,
  getOrganizationMembersByNormalizedEmails: db.getOrganizationMembersByNormalizedEmails,
  getStudentOrganizationMemberByOrgAndEmail: vi.fn(),
  hasActiveOrganizationInviteForEmail: vi.fn(),
  revokeActiveOrganizationInvitesByEmails: db.revokeActiveOrganizationInvitesByEmails,
  updateOrganizationAudienceMember: vi.fn()
}));

vi.mock('@cio/db/queries/group', () => ({
  addGroupMembers: vi.fn(),
  enrollUsersInCourseGroups: vi.fn(),
  getExistingGroupMembers: vi.fn(async () => [])
}));

vi.mock('@cio/db/queries/program', () => ({
  addProgramMember: vi.fn(),
  getExistingProgramMembers: vi.fn(async () => []),
  getProgramsByOrg: vi.fn(async () => [])
}));

vi.mock('@cio/db/queries/course', () => ({
  getCourseGroupIds: db.getCourseGroupIds,
  getOrgCourseGroups: vi.fn(),
  getOrgCourses: db.getOrgCourses
}));

vi.mock('@cio/db/queries/auth', () => ({ getProfilesByEmails: db.getProfilesByEmails }));
vi.mock('@cio/email', () => ({ buildEmailFromName: (name: string) => `"${name}" <envios@empresa.ejemplo>` }));
vi.mock('@api/services/organization/sender-name', () => ({ resolveSenderName: async () => 'Consultora Ejemplo' }));
vi.mock('@api/services/jobs', () => ({ enqueueTransactionalEmail: db.enqueueTransactionalEmail }));
vi.mock('@api/services/course/compliance', () => ({ ensureComplianceEnrollmentRecordsForProfiles: vi.fn() }));
vi.mock('@api/utils/org-url', () => ({ resolveOrgUrlIdentity: async () => ({ siteName: 'cliente' }) }));
vi.mock('@api/config/dashboard-url', () => ({ getDashboardBaseUrl: () => 'https://aula.empresa.ejemplo' }));

const { importAudienceMembers, invitationCoversAccess } = await import('@api/services/organization/audience');
const { AppError } = await import('@api/utils/errors');

const ORG = 'org-cliente';
const CURSO = 'curso-nuevo';
const OTRO_CURSO = 'curso-viejo';

/** Una persona importada antes que todavía no entró: fila de miembro sin perfil. */
const pendiente = (email: string) => ({ normalizedEmail: email, roleId: ROLE.STUDENT, profileId: null });

const correosEncolados = () =>
  db.enqueueTransactionalEmail.mock.calls.map(([, payload]) => (payload as { to: string }).to);

const correosRevocados = () =>
  db.revokeActiveOrganizationInvitesByEmails.mock.calls.flatMap(([, emails]) => emails as string[]);

beforeEach(() => {
  vi.clearAllMocks();

  db.getOrganizationById.mockResolvedValue({ id: ORG, name: 'Cliente', siteName: 'cliente' });
  db.getOrgCourses.mockResolvedValue({ items: [{ id: CURSO, title: 'Curso nuevo' }] });
  db.getCourseGroupIds.mockResolvedValue([{ groupId: 'grupo-1' }]);
  db.getProfilesByEmails.mockResolvedValue([]);
  db.revokeActiveOrganizationInvitesByEmails.mockResolvedValue([]);
  db.createOrganizationInvites.mockImplementation(async (rows: Array<{ email: string }>) =>
    rows.map((row) => ({ ...row, id: `inv-${row.email}` }))
  );
  db.createOrganizationInviteAudits.mockResolvedValue(undefined);
  db.createOrganizationMembers.mockResolvedValue(undefined);
  db.enqueueTransactionalEmail.mockResolvedValue({ jobIds: ['j'] });
});

describe('volver a importar a quien ya está invitado', () => {
  it('no revoca ni reenvía una invitación vigente que ya lleva al curso', async () => {
    db.getOrganizationMembersByNormalizedEmails.mockResolvedValue([
      pendiente('ana@ejemplo.test'),
      pendiente('beto@ejemplo.test'),
      pendiente('caro@ejemplo.test')
    ]);
    db.getActiveOrganizationInvitesByEmails.mockResolvedValue([
      // Vigente y ya incluye el curso: se deja.
      { email: 'ana@ejemplo.test', metadata: { courseIds: [CURSO] } },
      // Vigente, pero para otro curso: se renueva para sumar el nuevo.
      { email: 'beto@ejemplo.test', metadata: { courseIds: [OTRO_CURSO] } }
      // caro: la suya venció, no aparece entre las vigentes.
    ]);

    const resultado = await importAudienceMembers(
      ORG,
      {
        recipientCsv: 'ana@ejemplo.test, beto@ejemplo.test, caro@ejemplo.test, dani@ejemplo.test',
        courseIds: [CURSO],
        allCourses: false,
        allPrograms: false,
        sendEmail: true
      },
      'perfil-docente'
    );

    expect(correosRevocados()).not.toContain('ana@ejemplo.test');
    expect(correosEncolados()).not.toContain('ana@ejemplo.test');
    expect(correosEncolados().sort()).toEqual(['beto@ejemplo.test', 'caro@ejemplo.test', 'dani@ejemplo.test']);
    expect(resultado).toMatchObject({ imported: 1, pendingInvitesRenewed: 2, pendingInvitesKept: 1, emailsSent: 3 });
  });

  it('pegar dos veces la misma lista no vuelve a mandar nada', async () => {
    db.getOrganizationMembersByNormalizedEmails.mockResolvedValue([pendiente('ana@ejemplo.test')]);
    db.getActiveOrganizationInvitesByEmails.mockResolvedValue([
      { email: 'ana@ejemplo.test', metadata: { courseIds: [CURSO] } }
    ]);

    const resultado = await importAudienceMembers(
      ORG,
      { recipientCsv: 'ANA@ejemplo.test', courseIds: [CURSO], allCourses: false, allPrograms: false, sendEmail: true },
      'perfil-docente'
    );

    expect(db.revokeActiveOrganizationInvitesByEmails).not.toHaveBeenCalled();
    expect(db.enqueueTransactionalEmail).not.toHaveBeenCalled();
    expect(resultado).toMatchObject({ pendingInvitesRenewed: 0, pendingInvitesKept: 1, emailsSent: 0 });
  });
});

describe('la lista rechazada entera', () => {
  it('un correo mal escrito vuelve con su código y los correos, sin invitar a nadie', async () => {
    const error = await importAudienceMembers(
      ORG,
      {
        recipientCsv: 'ana@ejemplo.test, beto@ejemplo, caro@@ejemplo.test',
        courseIds: [CURSO],
        allCourses: false,
        allPrograms: false,
        sendEmail: true
      },
      'perfil-docente'
    ).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({
      code: 'AUDIENCE_INVALID_EMAILS',
      statusCode: 400,
      details: { emails: ['beto@ejemplo', 'caro@@ejemplo.test'] }
    });
    expect(db.createOrganizationMembers).not.toHaveBeenCalled();
    expect(db.enqueueTransactionalEmail).not.toHaveBeenCalled();
  });

  it('un correo del equipo vuelve con su código y los correos', async () => {
    db.getOrganizationMembersByNormalizedEmails.mockResolvedValue([
      { normalizedEmail: 'tutora@ejemplo.test', roleId: ROLE.TUTOR, profileId: 'p-1' }
    ]);

    const error = await importAudienceMembers(
      ORG,
      {
        recipientCsv: 'tutora@ejemplo.test, dani@ejemplo.test',
        courseIds: [CURSO],
        allCourses: false,
        allPrograms: false,
        sendEmail: true
      },
      'perfil-docente'
    ).catch((e: unknown) => e);

    expect(error).toMatchObject({ code: 'AUDIENCE_STAFF_EMAILS', details: { emails: ['tutora@ejemplo.test'] } });
    expect(db.createOrganizationMembers).not.toHaveBeenCalled();
  });
});

describe('invitationCoversAccess', () => {
  it('cubre cuando la invitación ya lleva todos los cursos y programas pedidos', () => {
    expect(invitationCoversAccess({ courseIds: ['a', 'b'], programIds: ['p'] }, ['a'], ['p'])).toBe(true);
  });

  it('no cubre si falta un curso o un programa', () => {
    expect(invitationCoversAccess({ courseIds: ['a'] }, ['a', 'b'], [])).toBe(false);
    expect(invitationCoversAccess({ courseIds: ['a'] }, ['a'], ['p'])).toBe(false);
  });

  it('una importación sin cursos se conforma con cualquier invitación vigente', () => {
    expect(invitationCoversAccess(null, [], [])).toBe(true);
  });
});
