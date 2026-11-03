/**
 * Sacar a un alumno de la empresa le corta el acceso, sin borrar nada, contra un
 * Postgres de verdad (Seguimiento, SaaS-RRHH, fase 23: el egreso).
 *
 * Antes, sacarlo de la organización borraba sólo su fila de `organizationmember`:
 * seguía entrando a sus cursos (la inscripción alcanzaba sola) y a sus programas,
 * y abrir un curso del programa le volvía a crear la membresía. Ahora la
 * membresía de la empresa es la llave del alumno: sin ella no entra a nada, su
 * inscripción, su avance y su certificado quedan, y volver a sumarlo se lo
 * devuelve todo. Lo único que sigue pudiendo hacer es bajar su certificado.
 *
 * Las compuertas son SQL: un mock no prueba esto. Se corren aparte, con
 * `pnpm --filter @cio/api test:db`.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { Hono } from 'hono';

// El servicio del curso limpia HTML con DOMPurify, que trae jsdom y no carga en Node 20. Acá no se
// limpia nada: se prueban las compuertas
vi.mock('isomorphic-dompurify', () => ({ default: { sanitize: (html: string) => html } }));

import { ROLE } from '@cio/utils/constants';
import {
  and,
  course,
  db,
  eq,
  group,
  groupmember,
  inArray,
  lesson,
  lessonCompletion,
  organization,
  organizationInvite,
  organizationmember,
  profile,
  program,
  programCourse,
  programMember,
  user
} from '@cio/db/drizzle';
import {
  getCourseProgramAccess,
  isCourseTeamMemberOrOrgAdmin,
  isEnrolledCourseStudent,
  isUserCourseMemberOrOrgAdmin
} from '@cio/db/queries/group';
import { getEnrolledProgramsByProfile, isProgramMember } from '@cio/db/queries/program';
import { removeAudienceByEmailService } from '@api/services/v1/audience';
import { ensureProgramCourseAccess } from '@api/services/course/course';
import { addProgramMembers } from '@api/services/program/program';
import { courseCertificateMiddleware, courseMemberMiddleware } from '@api/middlewares/course-member';

/** Marca de esta corrida: la base de desarrollo es compartida. */
const RUN = randomUUID().slice(0, 8);

const ALUMNA = randomUUID();
/** La administradora de la empresa: es quien firma la clave de la API. */
const ADMIN = randomUUID();
/** Del equipo del curso, sin fila en la empresa: al equipo no se le pide. */
const TUTORA = randomUUID();
/** Se suma a un programa que todavía no tiene cursos. */
const NUEVA = randomUUID();
const PERSONAS = [ALUMNA, ADMIN, TUTORA, NUEVA];
const correo = (id: string) => `p${PERSONAS.indexOf(id)}-${RUN}@test.local`;
/** Invitada sin aceptar: tiene su fila sin perfil y su invitación vigente. */
const INVITADA = `invitada-${RUN}@test.local`;

const EMPRESA = randomUUID();
const GRUPO = randomUUID();
const CURSO = randomUUID();
/** El curso del programa: la alumna no está inscripta, entra por el programa. */
const GRUPO_DEL_PROGRAMA = randomUUID();
const CURSO_DEL_PROGRAMA = randomUUID();
const PROGRAMA = randomUUID();
const PROGRAMA_SIN_CURSOS = randomUUID();
const LECCION = randomUUID();
const CERTIFICADO_AT = '2026-10-21T15:00:00.000Z';

const GRUPOS = [GRUPO, GRUPO_DEL_PROGRAMA];
const CURSOS = [CURSO, CURSO_DEL_PROGRAMA];
const PROGRAMAS = [PROGRAMA, PROGRAMA_SIN_CURSOS];

async function limpiar() {
  await db.delete(lessonCompletion).where(inArray(lessonCompletion.profileId, PERSONAS));
  await db.delete(lesson).where(eq(lesson.id, LECCION));
  await db.delete(programMember).where(inArray(programMember.programId, PROGRAMAS));
  await db.delete(programCourse).where(inArray(programCourse.programId, PROGRAMAS));
  await db.delete(program).where(inArray(program.id, PROGRAMAS));
  await db.delete(groupmember).where(inArray(groupmember.groupId, GRUPOS));
  await db.delete(course).where(inArray(course.id, CURSOS));
  await db.delete(group).where(inArray(group.id, GRUPOS));
  await db.delete(organizationInvite).where(eq(organizationInvite.organizationId, EMPRESA));
  await db.delete(organizationmember).where(eq(organizationmember.organizationId, EMPRESA));
  await db.delete(organization).where(eq(organization.id, EMPRESA));
  await db.delete(profile).where(inArray(profile.id, PERSONAS));
  await db.delete(user).where(inArray(user.id, PERSONAS));
}

/** La fila de la alumna en la empresa, como la deja aceptar una invitación. */
const sumarALaEmpresa = (profileId: string) =>
  db.insert(organizationmember).values({
    organizationId: EMPRESA,
    profileId,
    roleId: ROLE.STUDENT,
    email: correo(profileId),
    verified: true
  });

const filasEnLaEmpresa = async (profileId: string) =>
  (
    await db
      .select({ id: organizationmember.id })
      .from(organizationmember)
      .where(and(eq(organizationmember.organizationId, EMPRESA), eq(organizationmember.profileId, profileId)))
  ).length;

/** Lo que responde una ruta con ese middleware, para la alumna. */
async function pasa(middleware: typeof courseMemberMiddleware, profileId: string) {
  const app = new Hono()
    .use('*', async (c, next) => {
      c.set('user' as never, { id: profileId } as never);
      await next();
    })
    .post('/:courseId/download/certificate', middleware, (c) => c.json({ ok: true }, 200));
  const r = await app.request(`/${CURSO}/download/certificate`, { method: 'POST' });
  return r.status;
}

beforeAll(async () => {
  try {
    await db.select({ id: user.id }).from(user).limit(1);
  } catch (error) {
    throw new Error(
      'No se pudo hablar con Postgres. Levantá la base y sincronizá el schema:\n' +
        '  docker compose -f docker/docker-compose.yaml up -d postgres\n' +
        '  pnpm --filter @cio/db db:setup\n' +
        `Detalle: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  await db.insert(user).values(PERSONAS.map((id, i) => ({ id, name: `Persona ${i}`, email: correo(id) })));
  await db
    .insert(profile)
    .values(
      PERSONAS.map((id, i) => ({ id, fullname: `Persona ${i}`, username: `egreso-${RUN}-${i}`, email: correo(id) }))
    );
  await db.insert(organization).values({ id: EMPRESA, name: `Empresa ${RUN}`, siteName: `int-egreso-${RUN}` });

  await db.insert(organizationmember).values([
    { organizationId: EMPRESA, profileId: ALUMNA, roleId: ROLE.STUDENT, email: correo(ALUMNA), verified: true },
    { organizationId: EMPRESA, profileId: ADMIN, roleId: ROLE.ADMIN, email: correo(ADMIN), verified: true },
    { organizationId: EMPRESA, roleId: ROLE.STUDENT, email: INVITADA, verified: false }
  ]);
  await db.insert(organizationInvite).values({
    organizationId: EMPRESA,
    roleId: ROLE.STUDENT,
    email: INVITADA,
    tokenHash: createHash('sha256').update(`token-${RUN}`).digest('hex'),
    createdByProfileId: ADMIN,
    expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString()
  });

  await db.insert(group).values([
    { id: GRUPO, name: `grupo-${RUN}`, organizationId: EMPRESA },
    { id: GRUPO_DEL_PROGRAMA, name: `grupo-programa-${RUN}`, organizationId: EMPRESA }
  ]);
  await db.insert(course).values([
    { id: CURSO, title: `curso-${RUN}`, description: '', groupId: GRUPO, certificate: { isDownloadable: true } },
    { id: CURSO_DEL_PROGRAMA, title: `curso-programa-${RUN}`, description: '', groupId: GRUPO_DEL_PROGRAMA }
  ]);
  await db.insert(groupmember).values([
    {
      groupId: GRUPO,
      profileId: ALUMNA,
      roleId: ROLE.STUDENT,
      email: correo(ALUMNA),
      certificateEarnedAt: CERTIFICADO_AT
    },
    { groupId: GRUPO, profileId: TUTORA, roleId: ROLE.TUTOR, email: correo(TUTORA) }
  ]);
  await db.insert(lesson).values({ id: LECCION, courseId: CURSO, title: `leccion-${RUN}` });
  await db.insert(lessonCompletion).values({ lessonId: LECCION, profileId: ALUMNA, isComplete: true });

  await db.insert(program).values([
    { id: PROGRAMA, name: `programa-${RUN}`, organizationId: EMPRESA },
    { id: PROGRAMA_SIN_CURSOS, name: `programa-vacio-${RUN}`, organizationId: EMPRESA }
  ]);
  await db.insert(programCourse).values({ programId: PROGRAMA, courseId: CURSO_DEL_PROGRAMA });
  await db
    .insert(programMember)
    .values({ programId: PROGRAMA, profileId: ALUMNA, roleId: ROLE.STUDENT, email: correo(ALUMNA) });
});

afterAll(limpiar);

describe('el egreso: sacarla de la empresa le corta el acceso', () => {
  it('antes de sacarla entra al curso, al programa y al curso del programa', async () => {
    expect(await isUserCourseMemberOrOrgAdmin(CURSO, ALUMNA)).toBe(true);
    expect(await isProgramMember(PROGRAMA, ALUMNA)).toBe(true);
    expect((await getEnrolledProgramsByProfile(ALUMNA)).map((p) => p.id)).toContain(PROGRAMA);
    expect(await getCourseProgramAccess(CURSO_DEL_PROGRAMA, ALUMNA)).not.toBeNull();
  });

  it('se la saca por su correo exacto, sin distinguir mayúsculas', async () => {
    expect(await removeAudienceByEmailService(EMPRESA, ADMIN, `  ${correo(ALUMNA).toUpperCase()} `)).toEqual({
      removed: 1,
      invitesRevoked: 0
    });
    expect(await filasEnLaEmpresa(ALUMNA)).toBe(0);
    // La segunda vez ya no estaba: no es un error
    expect(await removeAudienceByEmailService(EMPRESA, ADMIN, correo(ALUMNA))).toEqual({
      removed: 0,
      invitesRevoked: 0
    });
  });

  it('ya no entra al curso, ni al programa, ni lo ve en su lista', async () => {
    expect(await isUserCourseMemberOrOrgAdmin(CURSO, ALUMNA)).toBe(false);
    expect(await isProgramMember(PROGRAMA, ALUMNA)).toBe(false);
    expect((await getEnrolledProgramsByProfile(ALUMNA)).map((p) => p.id)).not.toContain(PROGRAMA);
    // Las lecciones (todo lo que pasa por courseMemberMiddleware): 403
    expect(await pasa(courseMemberMiddleware, ALUMNA)).toBe(403);
  });

  it('y el programa ya no la vuelve a sumar a la empresa', async () => {
    expect(await getCourseProgramAccess(CURSO_DEL_PROGRAMA, ALUMNA)).toBeNull();
    expect(await ensureProgramCourseAccess(CURSO_DEL_PROGRAMA, ALUMNA)).toBe(false);
    expect(await filasEnLaEmpresa(ALUMNA)).toBe(0);
  });

  it('no se borró nada: su inscripción, su certificado, su avance y su programa quedan', async () => {
    const [inscripcion] = await db
      .select({ certificateEarnedAt: groupmember.certificateEarnedAt })
      .from(groupmember)
      .where(and(eq(groupmember.groupId, GRUPO), eq(groupmember.profileId, ALUMNA)));
    expect(new Date(inscripcion.certificateEarnedAt!).toISOString()).toBe(CERTIFICADO_AT);
    const avance = await db.select().from(lessonCompletion).where(eq(lessonCompletion.profileId, ALUMNA));
    expect(avance.map((a) => [a.lessonId, a.isComplete])).toEqual([[LECCION, true]]);
    const programa = await db.select().from(programMember).where(eq(programMember.profileId, ALUMNA));
    expect(programa.map((p) => p.programId)).toEqual([PROGRAMA]);
  });

  it('sigue pudiendo bajar su certificado: sólo esa ruta', async () => {
    expect(await isEnrolledCourseStudent(CURSO, ALUMNA)).toBe(true);
    expect(await pasa(courseCertificateMiddleware, ALUMNA)).toBe(200);
    // Quien nunca estuvo inscripto, no
    expect(await pasa(courseCertificateMiddleware, NUEVA)).toBe(403);
  });

  it('volver a sumarla a la empresa le devuelve todo, con su avance', async () => {
    await sumarALaEmpresa(ALUMNA);

    expect(await isUserCourseMemberOrOrgAdmin(CURSO, ALUMNA)).toBe(true);
    expect(await isProgramMember(PROGRAMA, ALUMNA)).toBe(true);
    expect((await getEnrolledProgramsByProfile(ALUMNA)).map((p) => p.id)).toContain(PROGRAMA);
    expect(await ensureProgramCourseAccess(CURSO_DEL_PROGRAMA, ALUMNA)).toBe(true);
    expect(await pasa(courseMemberMiddleware, ALUMNA)).toBe(200);
    const avance = await db.select().from(lessonCompletion).where(eq(lessonCompletion.profileId, ALUMNA));
    expect(avance).toHaveLength(1);
  });
});

describe('lo que no tiene que pasar', () => {
  it('al equipo no lo toca: sacar a la administradora por su correo no la saca', async () => {
    expect(await removeAudienceByEmailService(EMPRESA, ADMIN, correo(ADMIN))).toEqual({
      removed: 0,
      invitesRevoked: 0
    });
    expect(await filasEnLaEmpresa(ADMIN)).toBe(1);
  });

  it('a la tutora del curso, sin fila en la empresa, no se le pide la membresía', async () => {
    expect(await isCourseTeamMemberOrOrgAdmin(CURSO, TUTORA)).toBe(true);
    expect(await isUserCourseMemberOrOrgAdmin(CURSO, TUTORA)).toBe(true);
  });

  it('a una invitada sin aceptar se le saca la fila y se le revoca la invitación', async () => {
    expect(await removeAudienceByEmailService(EMPRESA, ADMIN, INVITADA)).toEqual({ removed: 1, invitesRevoked: 1 });
    const [invitacion] = await db
      .select({ isRevoked: organizationInvite.isRevoked })
      .from(organizationInvite)
      .where(eq(organizationInvite.email, INVITADA));
    expect(invitacion.isRevoked).toBe(true);
  });

  it('el correo se compara entero: el _ no es un comodín', async () => {
    // "p0_..." no es "p0-...": con la búsqueda por parecido, el _ habría coincidido
    const parecido = correo(ALUMNA).replace('-', '_');
    expect(await removeAudienceByEmailService(EMPRESA, ADMIN, parecido)).toEqual({ removed: 0, invitesRevoked: 0 });
    expect(await filasEnLaEmpresa(ALUMNA)).toBe(1);
  });
});

describe('un alumno de un programa sin cursos', () => {
  it('queda miembro de la empresa al sumarlo: si no, no entraría al programa', async () => {
    const { added, errors } = await addProgramMembers(PROGRAMA_SIN_CURSOS, {
      members: [{ profileId: NUEVA, email: correo(NUEVA), roleId: ROLE.STUDENT }]
    });
    expect(errors).toEqual([]);
    expect(added).toHaveLength(1);
    expect(await filasEnLaEmpresa(NUEVA)).toBe(1);
    expect(await isProgramMember(PROGRAMA_SIN_CURSOS, NUEVA)).toBe(true);
  });
});
