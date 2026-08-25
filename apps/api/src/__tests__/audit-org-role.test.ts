/**
 * De qué rol queda registrada cada acción.
 *
 * La auditoría existe para poder responder "¿quién miró esto?", y en un LMS de
 * empresa la respuesta útil no es sólo el nombre: es si esa persona era admin,
 * tutor o alumno EN esa empresa. Sin el rol, la fila cuenta la mitad del hecho.
 *
 * Este test nace de encontrarlo roto en producción: `org_role` estaba NULO en el
 * 100% de las filas. La causa fue leer el rol de `c.get('userRole')`, una clave
 * que **sólo escribe `orgMemberMiddleware`** — y las rutas de administración
 * (`/team`, `/audience`, `/tracking/overview`) usan `orgTeamMemberMiddleware`,
 * que calcula el mismo rol y nunca lo pone en el contexto. O sea que quedaba
 * vacío exactamente en las rutas donde más importa.
 *
 * Lo que lo hacía invisible: el test del middleware fingía el contexto poniendo
 * `userRole` a mano. Pasaba en verde afirmando un valor que la app real nunca
 * producía. Un arnés que arma un contexto que la aplicación no arma no prueba la
 * aplicación: se prueba a sí mismo.
 *
 * Por eso ahora el rol se resuelve desde `orgRoles`, que `app.ts` deja para toda
 * sesión pase por el middleware que pase, y por eso esto se afirma aparte.
 */
import { describe, expect, it } from 'vitest';

import { ROLE } from '@cio/utils/constants';
import { resolveOrgRole } from '@api/middlewares/audit-request';

const ORG = 'org-propia';
const AJENA = 'org-ajena';

describe('resolveOrgRole', () => {
  it('devuelve el rol que la persona tiene en la empresa del request', () => {
    expect(resolveOrgRole({ [ORG]: ROLE.ADMIN }, ORG)).toBe(ROLE.ADMIN);
  });

  it('distingue tutor de admin', () => {
    // Si esto se aplastara a un booleano "es del equipo", la auditoría dejaría
    // de poder responder quién configuró algo y quién sólo dio clase.
    expect(resolveOrgRole({ [ORG]: ROLE.TUTOR }, ORG)).toBe(ROLE.TUTOR);
  });

  it('registra también al alumno', () => {
    expect(resolveOrgRole({ [ORG]: ROLE.STUDENT }, ORG)).toBe(ROLE.STUDENT);
  });

  it('toma el rol de la empresa pedida, no de otra donde la persona sea admin', () => {
    // Alguien que administra una consultora y es alumno en una cliente tiene que
    // quedar registrado como alumno cuando actúa sobre la cliente.
    const roles = { [AJENA]: ROLE.ADMIN, [ORG]: ROLE.STUDENT };

    expect(resolveOrgRole(roles, ORG)).toBe(ROLE.STUDENT);
    expect(resolveOrgRole(roles, AJENA)).toBe(ROLE.ADMIN);
  });

  it('da null en las rutas de plataforma, donde no hay empresa activa', () => {
    // `/platform/*` es cross-empresa a propósito: ahí no hay rol de empresa que
    // registrar, y null es la respuesta honesta.
    expect(resolveOrgRole({ [ORG]: ROLE.ADMIN }, null)).toBeNull();
  });

  it('da null si la persona no pertenece a la empresa del request', () => {
    // Puede pasar en un 403: el request nombra una empresa ajena. La fila queda
    // igual, con el rol vacío, que es exactamente lo que ocurrió.
    expect(resolveOrgRole({ [AJENA]: ROLE.ADMIN }, ORG)).toBeNull();
  });

  it('da null, y no rompe, si la sesión no trae mapa de roles', () => {
    // La auditoría corre DESPUÉS de la respuesta: si tirara acá, el error caería
    // fuera del ciclo del request.
    expect(resolveOrgRole(undefined, ORG)).toBeNull();
  });

  it('no confunde el rol ADMIN, que vale 1, con un booleano', () => {
    // ROLE.ADMIN === 1 y ROLE.STUDENT === 3: un `|| null` en vez de `?? null`
    // seguiría funcionando para los tres roles actuales, pero convertiría en
    // null cualquier rol futuro que valga 0. Se afirma el valor, no la verdad.
    expect(resolveOrgRole({ [ORG]: 0 }, ORG)).toBe(0);
  });
});
