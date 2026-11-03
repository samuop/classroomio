/**
 * El operador de la plataforma no queda como docente de un curso que arma para
 * una empresa cliente.
 *
 * ── Qué pasaba ───────────────────────────────────────────────────────────────
 *
 * `createCourse` sumaba siempre a quien crea como TUTOR y le firmaba el aviso de
 * bienvenida. El operador entra a toda empresa por acceso derivado, sin fila de
 * miembro. Un curso que armó para un cliente lo mostraba entonces como único
 * docente, y como autor del aviso fijado, con el nombre de la cuenta de operador.
 * Lo vio el usuario en la pantalla de Noticias.
 *
 * ── El arnés ─────────────────────────────────────────────────────────────────
 *
 * Sin Postgres: las consultas se reemplazan por módulo y la transacción corre el
 * callback con un cliente de mentira, como la de verdad. Lo que se prueba es la
 * decisión y lo que se escribe: si se suma la membresía y si se crea el aviso.
 * Ids inventados.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ORG = '00000000-0000-4000-8000-0000000000aa';
const OPERADOR = '00000000-0000-4000-8000-000000000001';
const ADMIN_DEL_CLIENTE = '00000000-0000-4000-8000-000000000002';

const estado = {
  operadores: new Set<string>(),
  miembrosDeLaEmpresa: new Set<string>()
};

const escrituras = {
  miembros: [] as Array<{ profileId: string; roleId: number }>,
  avisos: [] as Array<{ authorId: string; courseId: string }>
};

vi.mock('@cio/db/drizzle', async (importOriginal) => {
  const original = await importOriginal<typeof import('@cio/db/drizzle')>();
  return {
    ...original,
    db: { ...original.db, transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({ tx: true }) }
  };
});

vi.mock('@cio/db/queries/organization', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@cio/db/queries/organization')>()),
  isPlatformAdmin: async (profileId: string) => estado.operadores.has(profileId),
  getOrganizationMemberIdByOrgAndProfile: async (orgId: string, profileId: string) =>
    orgId === ORG && estado.miembrosDeLaEmpresa.has(profileId) ? 77 : null
}));

vi.mock('@cio/db/queries/group', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@cio/db/queries/group')>()),
  createGroup: async () => [{ id: 'grupo-1' }],
  addGroupMember: async (valores: { profileId: string; roleId: number }) => {
    escrituras.miembros.push({ profileId: valores.profileId, roleId: valores.roleId });
    return [{ id: `miembro-${valores.profileId}` }];
  }
}));

vi.mock('@cio/db/queries/course', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@cio/db/queries/course')>()),
  createCourse: async () => [{ id: 'curso-1', title: 'Curso de prueba' }],
  createCourseNewsfeed: async (valores: { authorId: string; courseId: string }) => {
    escrituras.avisos.push({ authorId: valores.authorId, courseId: valores.courseId });
    return [{ id: 'aviso-1' }];
  }
}));

const { createCourse } = await import('@api/services/course/course');
const { ROLE } = await import('@cio/utils/constants');

const DATOS = {
  title: 'Curso de prueba',
  description: '<p>Algo</p>',
  type: 'SELF_PACED',
  organizationId: ORG
} as Parameters<typeof createCourse>[1];

beforeEach(() => {
  estado.operadores.clear();
  estado.miembrosDeLaEmpresa.clear();
  escrituras.miembros.length = 0;
  escrituras.avisos.length = 0;
});

describe('quién queda como docente al crear un curso', () => {
  it('el operador, en una empresa de la que no es miembro, no se suma ni firma el aviso', async () => {
    estado.operadores.add(OPERADOR);

    const resultado = await createCourse(OPERADOR, DATOS);

    expect(resultado.course.id).toBe('curso-1');
    expect(resultado.memberId).toBeNull();
    expect(escrituras.miembros).toEqual([]);
    expect(escrituras.avisos).toEqual([]);
  });

  it('el operador que sí es miembro de la empresa crea como cualquiera', async () => {
    estado.operadores.add(OPERADOR);
    estado.miembrosDeLaEmpresa.add(OPERADOR);

    const resultado = await createCourse(OPERADOR, DATOS);

    expect(escrituras.miembros).toEqual([{ profileId: OPERADOR, roleId: ROLE.TUTOR }]);
    expect(escrituras.avisos).toEqual([{ authorId: `miembro-${OPERADOR}`, courseId: 'curso-1' }]);
    expect(resultado.memberId).toBe(`miembro-${OPERADOR}`);
  });

  it('quien no es operador queda como docente y firma el aviso, como siempre', async () => {
    const resultado = await createCourse(ADMIN_DEL_CLIENTE, DATOS);

    expect(escrituras.miembros).toEqual([{ profileId: ADMIN_DEL_CLIENTE, roleId: ROLE.TUTOR }]);
    expect(escrituras.avisos).toEqual([{ authorId: `miembro-${ADMIN_DEL_CLIENTE}`, courseId: 'curso-1' }]);
    expect(resultado.memberId).toBe(`miembro-${ADMIN_DEL_CLIENTE}`);
  });
});
