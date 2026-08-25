/**
 * Los tres middlewares que custodian TODA ruta de empresa, contra apps Hono
 * reales.
 *
 * `orgMember` (pertenecer), `orgTeamMember` (admin o tutor) y `orgAdmin` (sólo
 * admin) son el escalón de acceso de la API entera. Ninguno tenía tests.
 *
 * Lo que los hace peligrosos es que fallan hacia adentro y en silencio: un
 * `!==` cambiado por `!=`, un rol nuevo agregado al enum, un `?? {}` que se
 * convierte en `?? ALL_ROLES` — nada de eso rompe una pantalla ni aparece en un
 * log. Sólo deja entrar a quien no debía, y todo sigue viéndose normal. Por eso
 * acá se afirma el escalón COMPLETO de cada uno: quién pasa y, sobre todo,
 * quién no.
 *
 * Los tres leen el rol de `orgRoles`, que la sesión ya trae, y ninguno consulta
 * la base — por eso alcanza con una app de mentira y un contexto armado a mano.
 */
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { ROLE } from '@cio/utils/constants';
import { orgAdminMiddleware } from '@api/middlewares/org-admin';
import { orgMemberMiddleware } from '@api/middlewares/org-member';
import { orgTeamMemberMiddleware } from '@api/middlewares/org-team-member';

const ORG = 'org-propia';
const AJENA = 'org-ajena';
const USUARIO = { id: 'u1', email: 'quien@ejemplo.test', role: null };

type Guard = typeof orgMemberMiddleware;

interface Escenario {
  /** `null` = nadie autenticado. */
  user?: typeof USUARIO | null;
  /** Lo que la sesión sabe de esta persona; `undefined` = sesión sin mapa. */
  orgRoles?: Record<string, number> | undefined;
  /** Header `cio-org-id`; `null` para no mandarlo. */
  header?: string | null;
}

/**
 * Corre el middleware con un contexto armado y devuelve el status.
 *
 * 200 significa que dejó pasar: la ruta de atrás sólo se alcanza si el guardia
 * llamó a `next()`.
 */
async function statusDe(guard: Guard, escenario: Escenario = {}): Promise<number> {
  const { user = USUARIO, header = ORG } = escenario;

  // A mano y no con un valor por omisión en la desestructuración: `orgRoles:
  // undefined` es un caso que hay que poder probar, y un default lo reemplaza
  // en silencio por el mapa de un admin. La primera versión de este arnés hacía
  // exactamente eso y convertía "sesión sin roles" en "admin".
  const orgRoles = 'orgRoles' in escenario ? escenario.orgRoles : { [ORG]: ROLE.ADMIN };

  const app = new Hono()
    .use('*', async (c, next) => {
      if (user) {
        c.set('user' as never, user as never);
        c.set('orgRoles' as never, orgRoles as never);
      }

      await next();
    })
    .use('*', guard)
    .get('/', (c) => c.json({ ok: true }));

  const headers: Record<string, string> = {};
  if (header) headers['cio-org-id'] = header;

  const res = await app.request('/', { headers });

  return res.status;
}

/** Los tres guardias, del más permisivo al más estricto. */
const GUARDIAS: Array<{ nombre: string; guard: Guard }> = [
  { nombre: 'orgMember', guard: orgMemberMiddleware },
  { nombre: 'orgTeamMember', guard: orgTeamMemberMiddleware },
  { nombre: 'orgAdmin', guard: orgAdminMiddleware }
];

describe('los guardias de acceso a una empresa', () => {
  describe.each(GUARDIAS)('$nombre — lo que ninguno debe permitir', ({ guard }) => {
    it('rechaza a quien no está autenticado', async () => {
      expect(await statusDe(guard, { user: null })).toBe(401);
    });

    it('rechaza si el request no dice de qué empresa habla', async () => {
      // Sin el header no hay contra qué comparar el rol. Elegir una empresa por
      // omisión acá sería exactamente el agujero que hay que evitar.
      expect(await statusDe(guard, { header: null })).toBe(400);
    });

    it('rechaza a un admin de OTRA empresa', async () => {
      // El caso que más importa de todos: ser admin no es un permiso global.
      expect(await statusDe(guard, { orgRoles: { [AJENA]: ROLE.ADMIN }, header: ORG })).toBe(403);
    });

    it('rechaza a quien no pertenece a ninguna empresa', async () => {
      expect(await statusDe(guard, { orgRoles: {} })).toBe(403);
    });

    it('rechaza cuando la sesión no trae mapa de roles', async () => {
      // El `?? {}` de los tres tiene que cerrar, no abrir.
      expect(await statusDe(guard, { orgRoles: undefined })).toBe(403);
    });
  });

  describe('orgMember: alcanza con pertenecer', () => {
    it('deja pasar al admin', async () => {
      expect(await statusDe(orgMemberMiddleware, { orgRoles: { [ORG]: ROLE.ADMIN } })).toBe(200);
    });

    it('deja pasar al tutor', async () => {
      expect(await statusDe(orgMemberMiddleware, { orgRoles: { [ORG]: ROLE.TUTOR } })).toBe(200);
    });

    it('deja pasar al alumno', async () => {
      expect(await statusDe(orgMemberMiddleware, { orgRoles: { [ORG]: ROLE.STUDENT } })).toBe(200);
    });
  });

  describe('orgTeamMember: admin o tutor, nunca alumno', () => {
    it('deja pasar al admin', async () => {
      expect(await statusDe(orgTeamMemberMiddleware, { orgRoles: { [ORG]: ROLE.ADMIN } })).toBe(200);
    });

    it('deja pasar al tutor', async () => {
      expect(await statusDe(orgTeamMemberMiddleware, { orgRoles: { [ORG]: ROLE.TUTOR } })).toBe(200);
    });

    it('FRENA al alumno', async () => {
      // Detrás de este guardia están la lista de alumnos, el seguimiento y el
      // equipo. Que un alumno vea el legajo de sus compañeros sería la peor
      // fuga posible en un LMS de empresa.
      expect(await statusDe(orgTeamMemberMiddleware, { orgRoles: { [ORG]: ROLE.STUDENT } })).toBe(403);
    });
  });

  describe('orgAdmin: sólo admin', () => {
    it('deja pasar al admin', async () => {
      expect(await statusDe(orgAdminMiddleware, { orgRoles: { [ORG]: ROLE.ADMIN } })).toBe(200);
    });

    it('FRENA al tutor', async () => {
      // Un tutor da clase; no configura la empresa ni administra su gente.
      expect(await statusDe(orgAdminMiddleware, { orgRoles: { [ORG]: ROLE.TUTOR } })).toBe(403);
    });

    it('FRENA al alumno', async () => {
      expect(await statusDe(orgAdminMiddleware, { orgRoles: { [ORG]: ROLE.STUDENT } })).toBe(403);
    });
  });

  describe('el escalón entre los tres es real', () => {
    it('cada guardia es más estricto que el anterior, no igual', async () => {
      // Si alguien afloja uno de los tres para desatascar algo, este test lo
      // dice. Sin él, `orgAdmin` podría volverse un alias de `orgTeamMember` y
      // nadie se enteraría.
      const tutor = { [ORG]: ROLE.TUTOR };
      const alumno = { [ORG]: ROLE.STUDENT };

      expect(await statusDe(orgMemberMiddleware, { orgRoles: alumno })).toBe(200);
      expect(await statusDe(orgTeamMemberMiddleware, { orgRoles: alumno })).toBe(403);

      expect(await statusDe(orgTeamMemberMiddleware, { orgRoles: tutor })).toBe(200);
      expect(await statusDe(orgAdminMiddleware, { orgRoles: tutor })).toBe(403);
    });
  });

  describe('el rol se compara contra la empresa del request, no contra cualquiera', () => {
    it('ser admin en otra empresa no habilita la del header', async () => {
      // La forma que toma este bug en la práctica: alguien administra dos
      // empresas, y una comparación laxa (`Object.values(orgRoles).includes`)
      // lo habilitaría en cualquiera de las dos indistintamente.
      const roles = { [AJENA]: ROLE.ADMIN, [ORG]: ROLE.STUDENT };

      expect(await statusDe(orgAdminMiddleware, { orgRoles: roles, header: ORG })).toBe(403);
      expect(await statusDe(orgAdminMiddleware, { orgRoles: roles, header: AJENA })).toBe(200);
    });
  });
});
