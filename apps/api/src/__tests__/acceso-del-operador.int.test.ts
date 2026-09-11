/**
 * El operador de plataforma administra todas las empresas, contra un Postgres
 * de verdad.
 *
 * La regla vive en varios lugares a la vez y hay que probarla en cada uno: el
 * mapa de la sesión (lo que leen todos los middlewares de empresa), el selector
 * de empresas, y las compuertas que le preguntan a la base directo — cursos,
 * programas, admin de empresa. Si una sola queda afuera, el operador entra a una
 * empresa y rebota en sus cursos. Un mock no puede probar esto: las compuertas
 * son SQL, y lo que decide es el motor.
 *
 * Y lo que NO tiene que pasar, que es lo que más importa: un usuario común no
 * gana nada, un operador baneado deja de serlo, y una empresa dada de baja no se
 * abre por ninguna puerta.
 *
 * Se corren aparte, con `pnpm --filter @cio/api test:db`.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';

import { PLATFORM_ROLE, ROLE } from '@cio/utils/constants';
import { course, db, eq, group, inArray, organization, organizationmember, profile, program, user } from '@cio/db/drizzle';
import {
  getOrganizationByProfileId,
  getUserOrgRole,
  getUserOrgRolesMap,
  isUserOrgAdmin,
  isUserOrgTeamMember
} from '@cio/db/queries/organization';
import { isCourseTeamMemberOrOrgAdmin, isUserCourseMemberOrOrgAdmin } from '@cio/db/queries/group';
import { isOrgAdminByProgramId } from '@cio/db/queries/program';

/** Marca de esta corrida: la base de desarrollo es compartida. */
const RUN = randomUUID().slice(0, 8);

const OPERADOR = randomUUID();
const BANEADO = randomUUID();
const COMUN = randomUUID();
const PERSONAS = [OPERADOR, BANEADO, COMUN];

const CONSULTORA = randomUUID();
/** Empresa hija de la consultora: el último nivel del árbol. */
const CLIENTE = randomUUID();
/** Sin relación con las otras. Ahí COMUN y OPERADOR son alumnos. */
const SUELTA = randomUUID();
const DADA_DE_BAJA = randomUUID();

const GRUPO = randomUUID();
const CURSO = randomUUID();
const PROGRAMA = randomUUID();

async function limpiar() {
  await db.delete(program).where(eq(program.id, PROGRAMA));
  await db.delete(course).where(eq(course.id, CURSO));
  await db.delete(group).where(eq(group.id, GRUPO));
  await db.delete(organizationmember).where(inArray(organizationmember.profileId, PERSONAS));
  // La hija primero: apunta a la consultora.
  await db.delete(organization).where(eq(organization.id, CLIENTE));
  await db.delete(organization).where(inArray(organization.id, [CONSULTORA, SUELTA, DADA_DE_BAJA]));
  await db.delete(profile).where(inArray(profile.id, PERSONAS));
  await db.delete(user).where(inArray(user.id, PERSONAS));
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

  await db.insert(user).values([
    { id: OPERADOR, name: 'Operador', email: `operador-${RUN}@test.local`, role: PLATFORM_ROLE.ADMIN },
    { id: BANEADO, name: 'Baneado', email: `baneado-${RUN}@test.local`, role: PLATFORM_ROLE.ADMIN, banned: true },
    { id: COMUN, name: 'Común', email: `comun-${RUN}@test.local` }
  ]);
  await db.insert(profile).values(
    PERSONAS.map((id, i) => ({ id, fullname: `Persona ${i}`, username: `int-${RUN}-${i}`, email: `p${i}-${RUN}@test.local` }))
  );

  await db.insert(organization).values([
    { id: CONSULTORA, name: `Consultora ${RUN}`, siteName: `int-consultora-${RUN}` },
    { id: SUELTA, name: `Suelta ${RUN}`, siteName: `int-suelta-${RUN}` },
    { id: DADA_DE_BAJA, name: `Baja ${RUN}`, siteName: `int-baja-${RUN}`, deletedAt: new Date().toISOString() }
  ]);
  await db
    .insert(organization)
    .values({ id: CLIENTE, name: `Cliente ${RUN}`, siteName: `int-cliente-${RUN}`, parentOrganizationId: CONSULTORA });

  await db.insert(organizationmember).values([
    { organizationId: SUELTA, profileId: COMUN, roleId: ROLE.STUDENT },
    { organizationId: SUELTA, profileId: OPERADOR, roleId: ROLE.STUDENT }
  ]);

  await db.insert(group).values({ id: GRUPO, name: `grupo-${RUN}`, organizationId: CLIENTE });
  await db.insert(course).values({ id: CURSO, title: `curso-${RUN}`, description: '', groupId: GRUPO });
  await db.insert(program).values({ id: PROGRAMA, name: `programa-${RUN}`, organizationId: CLIENTE });
});

afterAll(limpiar);

describe('el operador de plataforma administra todas las empresas', () => {
  it('el mapa de la sesión le da ADMIN en cada empresa viva, hasta la última hija', async () => {
    const mapa = await getUserOrgRolesMap(OPERADOR);

    expect(mapa[CONSULTORA]).toBe(ROLE.ADMIN);
    expect(mapa[CLIENTE]).toBe(ROLE.ADMIN);
  });

  it('y ADMIN donde además tiene una fila de alumno: el techo pisa a la fila', async () => {
    expect((await getUserOrgRolesMap(OPERADOR))[SUELTA]).toBe(ROLE.ADMIN);
    expect(await getUserOrgRole(SUELTA, OPERADOR)).toBe(ROLE.ADMIN);
  });

  it('el selector de empresas las lista, como ADMIN y sin inventar una fila de miembro', async () => {
    const porId = new Map((await getOrganizationByProfileId(OPERADOR)).map((org) => [org.id, org]));

    for (const id of [CONSULTORA, CLIENTE]) {
      expect(porId.get(id)?.roleId).toBe(ROLE.ADMIN);
      expect(porId.get(id)?.memberId).toBeUndefined();
    }

    // Donde sí es miembro, conserva su fila pero se muestra el rol que el
    // servidor hace cumplir.
    expect(porId.get(SUELTA)?.memberId).toBeDefined();
    expect(porId.get(SUELTA)?.roleId).toBe(ROLE.ADMIN);
  });

  it('pasa las compuertas que le preguntan a la base directo', async () => {
    expect(await isUserOrgAdmin(CLIENTE, OPERADOR)).toBe(true);
    expect(await isUserOrgTeamMember(CLIENTE, OPERADOR)).toBe(true);
    expect(await getUserOrgRole(CLIENTE, OPERADOR)).toBe(ROLE.ADMIN);
    expect(await isUserCourseMemberOrOrgAdmin(CURSO, OPERADOR)).toBe(true);
    expect(await isCourseTeamMemberOrOrgAdmin(CURSO, OPERADOR)).toBe(true);
    expect(await isOrgAdminByProgramId(PROGRAMA, OPERADOR)).toBe(true);
  });
});

describe('lo que no tiene que pasar', () => {
  it('una empresa dada de baja no se abre por ninguna puerta', async () => {
    expect((await getUserOrgRolesMap(OPERADOR))[DADA_DE_BAJA]).toBeUndefined();
    expect((await getOrganizationByProfileId(OPERADOR)).some((org) => org.id === DADA_DE_BAJA)).toBe(false);
    expect(await isUserOrgAdmin(DADA_DE_BAJA, OPERADOR)).toBe(false);
    expect(await isUserOrgTeamMember(DADA_DE_BAJA, OPERADOR)).toBe(false);
    expect(await getUserOrgRole(DADA_DE_BAJA, OPERADOR)).toBeNull();
  });

  it('un operador baneado no conserva nada, aunque siga teniendo el rol', async () => {
    const mapa = await getUserOrgRolesMap(BANEADO);

    expect(mapa[CONSULTORA]).toBeUndefined();
    expect(mapa[CLIENTE]).toBeUndefined();
    expect(await getOrganizationByProfileId(BANEADO)).toEqual([]);
    expect(await isUserOrgAdmin(CLIENTE, BANEADO)).toBe(false);
    expect(await getUserOrgRole(CLIENTE, BANEADO)).toBeNull();
    expect(await isUserCourseMemberOrOrgAdmin(CURSO, BANEADO)).toBe(false);
    expect(await isCourseTeamMemberOrOrgAdmin(CURSO, BANEADO)).toBe(false);
    expect(await isOrgAdminByProgramId(PROGRAMA, BANEADO)).toBe(false);
  });

  it('un usuario común se queda exactamente con lo suyo', async () => {
    expect(await getUserOrgRolesMap(COMUN)).toEqual({ [SUELTA]: ROLE.STUDENT });
    expect((await getOrganizationByProfileId(COMUN)).map((org) => [org.id, org.roleId])).toEqual([
      [SUELTA, ROLE.STUDENT]
    ]);
    expect(await getUserOrgRole(SUELTA, COMUN)).toBe(ROLE.STUDENT);
    expect(await isUserOrgAdmin(SUELTA, COMUN)).toBe(false);
    expect(await isUserOrgAdmin(CLIENTE, COMUN)).toBe(false);
    expect(await isUserCourseMemberOrOrgAdmin(CURSO, COMUN)).toBe(false);
    expect(await isCourseTeamMemberOrOrgAdmin(CURSO, COMUN)).toBe(false);
    expect(await isOrgAdminByProgramId(PROGRAMA, COMUN)).toBe(false);
  });
});
