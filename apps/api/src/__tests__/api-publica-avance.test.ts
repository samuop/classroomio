/**
 * La API pública para Seguimiento (SaaS-RRHH, fase 22): el avance de varias personas a la vez.
 *
 * Seguimiento guarda en el legajo de cada empleado una copia de su avance en el Campus, y la
 * actualiza cada hora. Por cada correo pregunta su estado en la organización, sus programas (las
 * "sendas") con el avance de cada curso, y los cursos que tiene sueltos.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getOrganizationStudentsByEmails = vi.fn();
const getLatestOrgInvitesByEmails = vi.fn();
const getProfileCourseProgressInOrg = vi.fn();
const getEnrolledProgramsByProfile = vi.fn();
const getCoursesByProgram = vi.fn();

vi.mock('@cio/db/queries/organization', () => ({
  getOrganizationStudentsByEmails: (...a: unknown[]) => getOrganizationStudentsByEmails(...a),
  getLatestOrgInvitesByEmails: (...a: unknown[]) => getLatestOrgInvitesByEmails(...a)
}));
vi.mock('@cio/db/queries/course', () => ({
  getProfileCourseProgressInOrg: (...a: unknown[]) => getProfileCourseProgressInOrg(...a)
}));
vi.mock('@cio/db/queries/program', () => ({
  getEnrolledProgramsByProfile: (...a: unknown[]) => getEnrolledProgramsByProfile(...a),
  getCoursesByProgram: (...a: unknown[]) => getCoursesByProgram(...a)
}));

const { getAudienceProgressService } = await import('@api/services/v1/progress');
const { ZPublicApiAudienceProgress } = await import('@cio/utils/validation/public-api');
const { ROLE } = await import('@cio/utils/constants');

const ORG = '11111111-1111-4111-8111-111111111111';
const OTRA_ORG = '99999999-9999-4999-8999-999999999999';
const INGRESO = '22222222-2222-4222-8222-222222222222';
const BIENVENIDA = 'c-bienvenida';
const SEGURIDAD = 'c-seguridad';
const EXCEL = 'c-excel';
const FUTURO = new Date(Date.now() + 86_400_000).toISOString();
const PASADO = new Date(Date.now() - 86_400_000).toISOString();

const curso = (courseId: string, lessonsCompleted: number, lessonsCount: number, extra = {}) => ({
  courseId,
  courseTitle: courseId,
  lessonsCount,
  lessonsCompleted,
  lastCompletedAt: '2026-10-20T15:00:00.000Z',
  certificateEarnedAt: null,
  ...extra
});

beforeEach(() => {
  vi.clearAllMocks();
  getLatestOrgInvitesByEmails.mockResolvedValue([]);
  getProfileCourseProgressInOrg.mockResolvedValue([]);
  getEnrolledProgramsByProfile.mockResolvedValue([]);
  getCoursesByProgram.mockResolvedValue([]);
});

describe('el estado de cada correo en la organización', () => {
  it('el que no es alumno no figura; el invitado, según su invitación', async () => {
    getOrganizationStudentsByEmails.mockResolvedValue([
      { memberId: 1, profileId: null, email: 'invitada@invalid.local' },
      { memberId: 2, profileId: null, email: 'vencida@invalid.local' }
    ]);
    getLatestOrgInvitesByEmails.mockResolvedValue([
      { email: 'invitada@invalid.local', acceptedAt: null, isRevoked: false, expiresAt: FUTURO },
      { email: 'vencida@invalid.local', acceptedAt: null, isRevoked: false, expiresAt: PASADO }
    ]);

    const r = await getAudienceProgressService(ORG, [
      'Invitada@invalid.local ',
      'vencida@invalid.local',
      'nadie@invalid.local'
    ]);
    expect(r).toEqual([
      { email: 'invitada@invalid.local', status: 'pending', programs: [], courses: [] },
      { email: 'vencida@invalid.local', status: 'expired', programs: [], courses: [] },
      { email: 'nadie@invalid.local', status: 'none', programs: [], courses: [] }
    ]);
    // Sólo se pregunta por lo de la organización de la clave, con los correos normalizados
    expect(getOrganizationStudentsByEmails).toHaveBeenCalledWith(ORG, [
      'invitada@invalid.local',
      'vencida@invalid.local',
      'nadie@invalid.local'
    ]);
    // Al que no aceptó no se le busca avance
    expect(getProfileCourseProgressInOrg).not.toHaveBeenCalled();
  });

  it('si un correo figura dos veces, manda el que ya aceptó', async () => {
    getOrganizationStudentsByEmails.mockResolvedValue([
      { memberId: 3, profileId: 'perfil-ana', email: 'ana@invalid.local' },
      { memberId: 1, profileId: null, email: 'ana@invalid.local' }
    ]);
    const [ana] = await getAudienceProgressService(ORG, ['ana@invalid.local']);
    expect(ana.status).toBe('active');
  });
});

describe('el avance de quien aceptó', () => {
  beforeEach(() => {
    getOrganizationStudentsByEmails.mockResolvedValue([
      { memberId: 3, profileId: 'perfil-ana', email: 'ana@invalid.local' },
      { memberId: 4, profileId: 'perfil-beto', email: 'beto@invalid.local' }
    ]);
    getEnrolledProgramsByProfile.mockResolvedValue([
      { id: INGRESO, name: 'Inducción general', organizationId: ORG, roleId: ROLE.STUDENT },
      { id: 'de-otra', name: 'De otra organización', organizationId: OTRA_ORG, roleId: ROLE.STUDENT },
      { id: 'da-clases', name: 'Donde es tutor', organizationId: ORG, roleId: ROLE.TUTOR }
    ]);
    getCoursesByProgram.mockImplementation(async (programId: string) =>
      programId === INGRESO
        ? [{ course: { id: BIENVENIDA, title: 'Bienvenida' } }, { course: { id: SEGURIDAD, title: 'Seguridad' } }]
        : []
    );
  });

  it('sus programas de la organización con cada curso, y aparte los sueltos', async () => {
    getProfileCourseProgressInOrg.mockImplementation(async (profileId: string) =>
      profileId === 'perfil-ana'
        ? [curso(BIENVENIDA, 4, 4, { certificateEarnedAt: '2026-10-21T10:00:00.000Z' }), curso(EXCEL, 1, 3)]
        : []
    );

    const [ana] = await getAudienceProgressService(ORG, ['ana@invalid.local']);
    expect(ana).toEqual({
      email: 'ana@invalid.local',
      status: 'active',
      programs: [
        {
          id: INGRESO,
          title: 'Inducción general',
          courses: [
            {
              id: BIENVENIDA,
              title: BIENVENIDA,
              progress: 100,
              completedAt: '2026-10-20T15:00:00.000Z',
              certificateAt: '2026-10-21T10:00:00.000Z'
            },
            // Del programa, todavía sin empezar
            { id: SEGURIDAD, title: 'Seguridad', progress: 0, completedAt: null, certificateAt: null }
          ]
        }
      ],
      // Un curso a medias no tiene día de terminado
      courses: [{ id: EXCEL, title: EXCEL, progress: 33, completedAt: null, certificateAt: null }]
    });
    // Los cursos de un programa, sólo los publicados: los que el alumno puede hacer
    expect(getCoursesByProgram).toHaveBeenCalledWith(INGRESO, true);
    expect(getProfileCourseProgressInOrg).toHaveBeenCalledWith('perfil-ana', ORG);
  });

  it('los cursos de un programa se piden una vez para todos', async () => {
    await getAudienceProgressService(ORG, ['ana@invalid.local', 'beto@invalid.local']);
    expect(getCoursesByProgram).toHaveBeenCalledTimes(1);
  });

  it('un curso sin lecciones queda en 0, y nunca pasa de 100', async () => {
    getProfileCourseProgressInOrg.mockResolvedValue([curso(BIENVENIDA, 0, 0), curso(SEGURIDAD, 5, 4)]);
    const [ana] = await getAudienceProgressService(ORG, ['ana@invalid.local']);
    expect(ana.programs[0].courses.map((c) => [c.progress, c.completedAt !== null])).toEqual([
      [0, false],
      [100, true]
    ]);
  });
});

describe('el pedido', () => {
  it('hasta 200 correos, y uno mal escrito no frena a los demás', () => {
    expect(ZPublicApiAudienceProgress.safeParse({ emails: ['no-es-un-correo', 'ana@invalid.local'] }).success).toBe(
      true
    );
    expect(ZPublicApiAudienceProgress.safeParse({ emails: [] }).success).toBe(false);
    const muchos = Array.from({ length: 201 }, (_, i) => `p${i}@invalid.local`);
    expect(ZPublicApiAudienceProgress.safeParse({ emails: muchos }).success).toBe(false);
  });
});
