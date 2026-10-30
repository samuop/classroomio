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
 * Y un correo mal escrito o del equipo ya no frena la lista: se invita al resto
 * y los descartados vuelven aparte. La lista se rechaza entera (con su código y
 * los correos culpables) sólo cuando no queda nadie a quien invitar.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ROLE } from '@cio/utils/constants';

const db = vi.hoisted(() => ({
  getOrganizationById: vi.fn(),
  getOrganizationMembersByNormalizedEmails: vi.fn(),
  getUnacceptedOrganizationInvitesByEmails: vi.fn(),
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
  getUnacceptedOrganizationInvitesByEmails: db.getUnacceptedOrganizationInvitesByEmails,
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
const { AppError, handleError } = await import('@api/utils/errors');
const { Hono } = await import('hono');

const ORG = 'org-cliente';
const CURSO = 'curso-nuevo';
const OTRO_CURSO = 'curso-viejo';

/** Una persona importada antes que todavía no entró: fila de miembro sin perfil. */
const pendiente = (email: string) => ({ normalizedEmail: email, roleId: ROLE.STUDENT, profileId: null });

const EN_TRES_DIAS = new Date(Date.now() + 3 * 86_400_000).toISOString();
const HACE_UN_DIA = new Date(Date.now() - 86_400_000).toISOString();

/** Una invitación sin aceptar ni revocar; `expiresAt` dice si sigue vigente. */
const invitacion = (email: string, courseIds: string[], expiresAt = EN_TRES_DIAS) => ({
  email,
  expiresAt,
  metadata: { courseIds }
});

/** La metadata de la invitación nueva que se creó para ese correo. */
const invitacionNueva = (email: string) =>
  db.createOrganizationInvites.mock.calls
    .flatMap(([filas]) => filas as Array<{ email: string; metadata: { courseIds?: string[] } }>)
    .find((fila) => fila.email === email)?.metadata;

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
    db.getUnacceptedOrganizationInvitesByEmails.mockResolvedValue([
      // Vigente y ya incluye el curso: se deja.
      invitacion('ana@ejemplo.test', [CURSO]),
      // Vigente, pero para otro curso: se renueva para sumar el nuevo.
      invitacion('beto@ejemplo.test', [OTRO_CURSO]),
      // Vencida: se renueva aunque ya llevara el curso.
      invitacion('caro@ejemplo.test', [CURSO], HACE_UN_DIA)
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
    db.getUnacceptedOrganizationInvitesByEmails.mockResolvedValue([invitacion('ana@ejemplo.test', [CURSO])]);

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

describe('invitar a un curso nuevo a quien todavía no entró', () => {
  it('la invitación nueva suma el curso nuevo a los que ya tenía, no los pierde', async () => {
    db.getOrganizationMembersByNormalizedEmails.mockResolvedValue([pendiente('beto@ejemplo.test')]);
    db.getUnacceptedOrganizationInvitesByEmails.mockResolvedValue([invitacion('beto@ejemplo.test', [OTRO_CURSO])]);

    await importAudienceMembers(
      ORG,
      { recipientCsv: 'beto@ejemplo.test', courseIds: [CURSO], allCourses: false, allPrograms: false, sendEmail: true },
      'perfil-docente'
    );

    expect(invitacionNueva('beto@ejemplo.test')?.courseIds?.sort()).toEqual([CURSO, OTRO_CURSO].sort());
  });

  it('también suma los de una invitación vencida', async () => {
    db.getOrganizationMembersByNormalizedEmails.mockResolvedValue([pendiente('caro@ejemplo.test')]);
    db.getUnacceptedOrganizationInvitesByEmails.mockResolvedValue([
      invitacion('caro@ejemplo.test', [OTRO_CURSO], HACE_UN_DIA)
    ]);

    await importAudienceMembers(
      ORG,
      { recipientCsv: 'caro@ejemplo.test', courseIds: [CURSO], allCourses: false, allPrograms: false, sendEmail: true },
      'perfil-docente'
    );

    expect(invitacionNueva('caro@ejemplo.test')?.courseIds?.sort()).toEqual([CURSO, OTRO_CURSO].sort());
  });

  it('a alguien nuevo lo invita sólo a lo pedido', async () => {
    db.getOrganizationMembersByNormalizedEmails.mockResolvedValue([]);
    db.getUnacceptedOrganizationInvitesByEmails.mockResolvedValue([]);

    await importAudienceMembers(
      ORG,
      { recipientCsv: 'dani@ejemplo.test', courseIds: [CURSO], allCourses: false, allPrograms: false, sendEmail: true },
      'perfil-docente'
    );

    expect(invitacionNueva('dani@ejemplo.test')?.courseIds).toEqual([CURSO]);
  });
});

describe('un correo malo no frena la lista', () => {
  const importar = (recipientCsv: string) =>
    importAudienceMembers(
      ORG,
      { recipientCsv, courseIds: [CURSO], allCourses: false, allPrograms: false, sendEmail: true },
      'perfil-docente'
    );

  const altas = () =>
    db.createOrganizationMembers.mock.calls.flatMap(([filas]) => (filas as Array<{ email: string }>).map((f) => f.email));

  beforeEach(() => {
    db.getOrganizationMembersByNormalizedEmails.mockResolvedValue([]);
    db.getUnacceptedOrganizationInvitesByEmails.mockResolvedValue([]);
  });

  it('invita a los bien escritos y devuelve los mal escritos para corregir', async () => {
    const resultado = await importar('ana@ejemplo.test, beto@ejemplo, caro@@ejemplo.test, dani@ejemplo.test');

    expect(altas().sort()).toEqual(['ana@ejemplo.test', 'dani@ejemplo.test']);
    expect(correosEncolados().sort()).toEqual(['ana@ejemplo.test', 'dani@ejemplo.test']);
    expect(resultado).toMatchObject({ imported: 2, skippedInvalid: ['beto@ejemplo', 'caro@@ejemplo.test'], skippedStaff: [] });
  });

  it('a alguien del equipo lo deja afuera e invita al resto', async () => {
    db.getOrganizationMembersByNormalizedEmails.mockResolvedValue([
      { normalizedEmail: 'tutora@ejemplo.test', roleId: ROLE.TUTOR, profileId: 'p-1' }
    ]);

    const resultado = await importar('tutora@ejemplo.test, dani@ejemplo.test');

    expect(altas()).toEqual(['dani@ejemplo.test']);
    expect(correosEncolados()).not.toContain('tutora@ejemplo.test');
    expect(resultado).toMatchObject({ imported: 1, skippedInvalid: [], skippedStaff: ['tutora@ejemplo.test'] });
  });

  it('si todos están mal escritos, rechaza con su código y los correos, sin invitar a nadie', async () => {
    const error = await importar('beto@ejemplo, caro@@ejemplo.test').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({
      code: 'AUDIENCE_INVALID_EMAILS',
      statusCode: 400,
      details: { emails: ['beto@ejemplo', 'caro@@ejemplo.test'] }
    });
    expect(db.createOrganizationMembers).not.toHaveBeenCalled();
    expect(db.enqueueTransactionalEmail).not.toHaveBeenCalled();
  });

  it('si todos son del equipo, rechaza con su código y los correos', async () => {
    db.getOrganizationMembersByNormalizedEmails.mockResolvedValue([
      { normalizedEmail: 'tutora@ejemplo.test', roleId: ROLE.TUTOR, profileId: 'p-1' }
    ]);

    const error = await importar('tutora@ejemplo.test').catch((e: unknown) => e);

    expect(error).toMatchObject({ code: 'AUDIENCE_STAFF_EMAILS', details: { emails: ['tutora@ejemplo.test'] } });
    expect(db.createOrganizationMembers).not.toHaveBeenCalled();
  });

  it('mal escritos y del equipo, sin nadie más: nada que hacer, rechaza por los mal escritos', async () => {
    db.getOrganizationMembersByNormalizedEmails.mockResolvedValue([
      { normalizedEmail: 'tutora@ejemplo.test', roleId: ROLE.TUTOR, profileId: 'p-1' }
    ]);

    const error = await importar('tutora@ejemplo.test, beto@ejemplo').catch((e: unknown) => e);

    expect(error).toMatchObject({ code: 'AUDIENCE_INVALID_EMAILS', details: { emails: ['beto@ejemplo'] } });
    expect(db.enqueueTransactionalEmail).not.toHaveBeenCalled();
  });
});

describe('la respuesta HTTP de un rechazo', () => {
  // `details` va en el JSON sin estar declarado en `ErrorResponse` (ver
  // `handleError`): nada de tipos lo cuida, así que lo cuida esto.
  const responder = async (error: Error) => {
    const app = new Hono().get('/importar', (c) => handleError(c, error));
    const respuesta = await app.request('/importar');
    return respuesta.json();
  };

  it('un 4xx lleva los correos culpables', async () => {
    const cuerpo = await responder(
      new AppError('Invalid emails found', 'AUDIENCE_INVALID_EMAILS', 400, 'recipientCsv', { emails: ['beto@ejemplo'] })
    );

    expect(cuerpo).toMatchObject({ code: 'AUDIENCE_INVALID_EMAILS', details: { emails: ['beto@ejemplo'] } });
  });

  it('un 5xx no deja salir nada del error interno', async () => {
    const cuerpo = await responder(new AppError('boom', 'INTERNO', 500, undefined, { secreto: 'x' }));

    expect(cuerpo).not.toHaveProperty('details');
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
