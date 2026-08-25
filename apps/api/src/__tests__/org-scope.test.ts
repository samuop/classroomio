/**
 * `assertOrgAccess`: la guarda que decide si alguien puede leer los datos de UNA
 * empresa nombrada en el request.
 *
 * Tapa un agujero que existió de verdad y se verificó contra un servidor vivo:
 * las rutas `/dash/*` reciben `orgId` por query string, pero su middleware sólo
 * miraba el header `cio-org-id`. Nada ataba las dos cosas, así que un admin de
 * una empresa leía el tablero de otra editando la URL — cantidad de alumnos,
 * lista de cursos y tasas de finalización de una compañía ajena.
 *
 * Se usa en siete lugares y hasta ahora **no tenía un solo test**. Eso es lo
 * peligroso de este tipo de función: cuando falla no rompe nada, no tira una
 * excepción y no aparece en ningún log. Simplemente deja pasar a quien no debía,
 * y todo se ve perfectamente normal.
 *
 * Por eso los casos que importan acá son los que tiene que RECHAZAR.
 */
import { describe, expect, it } from 'vitest';
import type { Context } from 'hono';

import { ROLE } from '@cio/utils/constants';
import { AppError } from '@api/utils/errors';
import { assertOrgAccess } from '@api/utils/org-scope';

const PROPIA = 'org-propia';
const AJENA = 'org-ajena';

/**
 * Un Context de Hono con lo único que la función mira: el mapa de roles que
 * `app.ts` deja para cada sesión. No hace falta más: la guarda decide con la
 * sesión y nunca consulta la base.
 */
function contextConRoles(orgRoles: Record<string, number>): Context {
  return { get: (key: string) => (key === 'orgRoles' ? orgRoles : undefined) } as unknown as Context;
}

/** Devuelve el AppError que tiró la llamada, o falla si no tiró ninguno. */
function errorDe(fn: () => void): AppError {
  try {
    fn();
  } catch (error) {
    return error as AppError;
  }

  throw new Error('se esperaba que rechazara, y dejó pasar');
}

describe('assertOrgAccess', () => {
  describe('deja pasar a quien corresponde', () => {
    it('al admin de la empresa que pidió', () => {
      const c = contextConRoles({ [PROPIA]: ROLE.ADMIN });

      expect(() => assertOrgAccess(c, PROPIA)).not.toThrow();
    });

    it('al tutor, cuando la ruta no exige ser admin', () => {
      const c = contextConRoles({ [PROPIA]: ROLE.TUTOR });

      expect(() => assertOrgAccess(c, PROPIA)).not.toThrow();
    });

    it('al alumno, cuando la ruta no exige ser admin', () => {
      // Pertenecer alcanza para las rutas que no piden más. Si alguna vez esto
      // deja de ser cierto, el cambio tiene que ser deliberado y romper acá.
      const c = contextConRoles({ [PROPIA]: ROLE.STUDENT });

      expect(() => assertOrgAccess(c, PROPIA)).not.toThrow();
    });

    it('al admin de la consultora sobre una empresa cliente', () => {
      // La derivación consultora → cliente ya viene resuelta dentro de
      // `orgRoles`. Que siga pasando es deliberado: es el mismo permiso del que
      // depende el hub de seguimiento.
      const c = contextConRoles({ consultora: ROLE.ADMIN, [PROPIA]: ROLE.ADMIN });

      expect(() => assertOrgAccess(c, PROPIA, { requireAdmin: true })).not.toThrow();
    });
  });

  describe('rechaza cruzar a otra empresa', () => {
    it('no deja leer una empresa donde la persona no es nada', () => {
      // ESTE es el agujero original: admin de la suya, pidiendo la ajena.
      const c = contextConRoles({ [PROPIA]: ROLE.ADMIN });

      const error = errorDe(() => assertOrgAccess(c, AJENA));

      expect(error).toBeInstanceOf(AppError);
      expect(error.statusCode).toBe(404);
    });

    it('responde 404 y no 403, para no confirmar que esa empresa existe', () => {
      // La diferencia no es cosmética: un 403 le dice a quien prueba ids que
      // acertó uno. El 404 hace que una empresa ajena sea indistinguible de una
      // inexistente.
      const c = contextConRoles({ [PROPIA]: ROLE.ADMIN });

      expect(errorDe(() => assertOrgAccess(c, AJENA)).statusCode).not.toBe(403);
    });

    it('no deja pasar a quien no pertenece a ninguna empresa', () => {
      const c = contextConRoles({});

      expect(errorDe(() => assertOrgAccess(c, PROPIA)).statusCode).toBe(404);
    });

    it('no deja pasar cuando la sesión no trae mapa de roles', () => {
      // Sin `orgRoles` la función tiene que cerrarse, no abrirse. Un `undefined`
      // interpretado como "todavía no sé, dejalo pasar" sería la peor variante
      // posible de este bug.
      const c = { get: () => undefined } as unknown as Context;

      expect(errorDe(() => assertOrgAccess(c, PROPIA)).statusCode).toBe(404);
    });
  });

  describe('exige ser admin cuando la ruta lo pide', () => {
    it('rechaza al tutor con 403', () => {
      const c = contextConRoles({ [PROPIA]: ROLE.TUTOR });

      const error = errorDe(() => assertOrgAccess(c, PROPIA, { requireAdmin: true }));

      expect(error.statusCode).toBe(403);
    });

    it('rechaza al alumno con 403', () => {
      const c = contextConRoles({ [PROPIA]: ROLE.STUDENT });

      expect(errorDe(() => assertOrgAccess(c, PROPIA, { requireAdmin: true })).statusCode).toBe(403);
    });

    it('al miembro de otra empresa le sigue dando 404, no 403', () => {
      // El orden de las comprobaciones importa: primero pertenencia, después
      // rol. Al revés, pedir una empresa ajena con `requireAdmin` devolvería 403
      // y volvería a confirmar que existe.
      const c = contextConRoles({ [PROPIA]: ROLE.ADMIN });

      expect(errorDe(() => assertOrgAccess(c, AJENA, { requireAdmin: true })).statusCode).toBe(404);
    });
  });

  describe('exige que el request nombre la empresa', () => {
    it('rechaza con 400 si no vino ningún id', () => {
      // Dos de estas rutas aceptan `siteName` en lugar de `orgId` y devuelven
      // exactamente las mismas cifras privadas. Saltear la comprobación cuando
      // falta el id dejaría el agujero abierto por la otra puerta.
      const c = contextConRoles({ [PROPIA]: ROLE.ADMIN });

      expect(errorDe(() => assertOrgAccess(c, undefined)).statusCode).toBe(400);
    });

    it('rechaza el string vacío igual que el ausente', () => {
      const c = contextConRoles({ [PROPIA]: ROLE.ADMIN });

      expect(errorDe(() => assertOrgAccess(c, '')).statusCode).toBe(400);
    });
  });
});
