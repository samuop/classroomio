/**
 * El mapa de auditoría: qué requests se registran y con qué nombre.
 *
 * Es la pieza que decide, y por eso la que más barato sale equivocar. Un matcher
 * laxo hace que bajar el detalle de un alumno se registre como "vio la lista"; un
 * prefijo de exclusión mal escrito apaga en silencio media auditoría; una función
 * de `metadata` descuidada copia a la tabla lo que justamente no debe estar ahí.
 */
import { describe, expect, it } from 'vitest';

import {
  AUDITED_READS,
  WRITE_ACTION_NAMES,
  findInAuditMap,
  genericAction,
  isExcluded,
  isWrite,
  matchPattern
} from '@api/utils/audit-map';

const url = (path: string) => new URL(path, 'https://learn.tensor.com.ar');

describe('matchPattern', () => {
  it('captura los params de un patrón', () => {
    expect(matchPattern('/course/:courseId/members', '/course/abc-123/members')).toEqual({ courseId: 'abc-123' });
  });

  it('exige la misma cantidad de segmentos', () => {
    // Sin esto, ver el avance de UN alumno se registraría como "vio la lista",
    // que es una diferencia importante.
    expect(matchPattern('/course/:courseId/members', '/course/abc/members/u1/analytics')).toBeNull();
    expect(matchPattern('/course/:courseId/members', '/course/abc')).toBeNull();
  });

  it('no matchea un segmento literal distinto', () => {
    expect(matchPattern('/organization/team', '/organization/audience')).toBeNull();
  });

  it('decodifica el param y no se cae con un porcentaje suelto', () => {
    expect(matchPattern('/course/:courseId', '/course/a%20b')).toEqual({ courseId: 'a b' });
    // `%zz` no es una secuencia válida: decodeURIComponent tira. Se prefiere el
    // valor crudo antes que perder la fila entera por un id mal formado.
    expect(matchPattern('/course/:courseId', '/course/%zz')).toEqual({ courseId: '%zz' });
  });
});

describe('findInAuditMap', () => {
  it('nombra la lectura del seguimiento y guarda sólo el scope', () => {
    const match = findInAuditMap('GET', url('/organization/tracking/overview?scope=all'));

    expect(match?.action).toBe('VIO_SEGUIMIENTO');
    expect(match?.metadata).toEqual({ scope: 'all' });
  });

  it('distingue el avance de un alumno de la lista de alumnos', () => {
    expect(findInAuditMap('GET', url('/course/c1/members'))?.action).toBe('VIO_ALUMNOS_DEL_CURSO');

    const detail = findInAuditMap('GET', url('/course/c1/members/u9/analytics'));
    expect(detail?.action).toBe('VIO_AVANCE_DE_ALUMNO');
    expect(detail?.entityId).toBe('c1');
    expect(detail?.metadata).toEqual({ userId: 'u9' });
  });

  it('no guarda el término buscado cuando no hay búsqueda', () => {
    expect(findInAuditMap('GET', url('/organization/audience'))?.metadata).toBeUndefined();
    expect(findInAuditMap('GET', url('/organization/audience?q=  ana '))?.metadata).toEqual({ term: 'ana' });
  });

  it('devuelve null para una lectura que no está declarada', () => {
    // No es un error: las lecturas son lista blanca a propósito. La escritura
    // equivalente sí se registra sola, con nombre genérico.
    expect(findInAuditMap('GET', url('/course/c1/lesson'))).toBeNull();
  });

  it('nombra las escrituras declaradas y respeta el método', () => {
    expect(findInAuditMap('PUT', url('/organization'))?.action).toBe('EDITO_EMPRESA');
    expect(findInAuditMap('POST', url('/organization'))?.action).toBe('CREO_EMPRESA');
    expect(findInAuditMap('DELETE', url('/organization'))).toBeNull();
  });

  it('no mira el mapa de escrituras cuando el método es GET, ni al revés', () => {
    // Los dos mapas tienen patrones que se pisan (`/organization`). Cruzarlos
    // haría que una lectura se registre con el nombre de la escritura.
    expect(findInAuditMap('GET', url('/organization'))).toBeNull();
    expect(findInAuditMap('POST', url('/organization/tracking/overview'))).toBeNull();
  });
});

describe('metadata: qué se deja salir a la tabla', () => {
  it('nunca copia el querystring entero', () => {
    // Un `metadata: (url) => Object.fromEntries(url.searchParams)` de apuro sería
    // la forma más fácil de terminar con un token de invitación escrito en la
    // auditoría. Cada campo se declara a mano, uno por uno.
    const match = findInAuditMap(
      'GET',
      url('/organization/tracking/overview?scope=own&token=secreto&password=1234')
    );

    expect(match?.metadata).toEqual({ scope: 'own' });
  });

  it('recorta el término de búsqueda', () => {
    const term = 'a'.repeat(500);
    const match = findInAuditMap('GET', url(`/organization/audience?q=${term}`));

    expect((match?.metadata as { term: string }).term).toHaveLength(200);
  });
});

describe('isExcluded', () => {
  it('excluye la autenticación y el sondeo de sesión', () => {
    expect(isExcluded('/api/auth/sign-in/email')).toBe(true);
    expect(isExcluded('/session')).toBe(true);
  });

  it('excluye el propio endpoint de reporte, para que no se realimente', () => {
    expect(isExcluded('/audit/incident')).toBe(true);
  });

  it('excluye la raíz, que es el health check', () => {
    expect(isExcluded('/')).toBe(true);
  });

  it('no excluye por prefijo parcial de un segmento', () => {
    // '/sessions-de-algo' empieza con '/session' como texto, pero es otra ruta.
    // Comparar con `startsWith` a secas apagaría rutas reales sin avisar.
    expect(isExcluded('/sessions-de-algo')).toBe(false);
    expect(isExcluded('/organization/tracking/overview')).toBe(false);
    expect(isExcluded('/audition')).toBe(false);
  });
});

describe('isWrite / genericAction', () => {
  it('reconoce los métodos que modifican', () => {
    expect(['POST', 'PUT', 'PATCH', 'DELETE'].every(isWrite)).toBe(true);
    expect(isWrite('GET')).toBe(false);
    expect(isWrite('get')).toBe(false);
  });

  it('arma un nombre legible para una escritura sin declarar', () => {
    expect(genericAction('post', '/course/c1/section')).toBe('POST /course/c1/section');
  });
});

/**
 * Chequeos de consistencia del mapa.
 *
 * No prueban comportamiento sino que el mapa esté bien escrito. Son los que
 * atajan el error más difícil de ver: una entrada que no falla, no rompe nada, y
 * simplemente nunca se dispara.
 */
describe('consistencia del mapa', () => {
  const allPatterns = [...AUDITED_READS.map((r) => r.pattern), ...WRITE_ACTION_NAMES.map((w) => w.pattern)];

  it('todos los patrones son rutas absolutas sin barra final', () => {
    for (const pattern of allPatterns) {
      expect(pattern.startsWith('/'), `"${pattern}" tiene que empezar con /`).toBe(true);
      expect(pattern.endsWith('/'), `"${pattern}" no puede terminar en /`).toBe(false);
    }
  });

  it('ninguna acción declarada cae bajo un prefijo excluido', () => {
    // Declarar una lectura de `/session/algo` compila, se ve bien y no se
    // dispara NUNCA, porque el middleware corta por exclusión antes de mirar el
    // mapa. Es un agujero silencioso.
    for (const pattern of allPatterns) {
      expect(isExcluded(pattern), `"${pattern}" está declarado pero además excluido`).toBe(false);
    }
  });

  it('no hay dos lecturas con el mismo patrón', () => {
    // La primera gana y la segunda queda muerta.
    const patterns = AUDITED_READS.map((r) => r.pattern);

    expect(new Set(patterns).size).toBe(patterns.length);
  });

  it('no hay dos escrituras con el mismo método y patrón', () => {
    const keys = WRITE_ACTION_NAMES.map((w) => `${w.method} ${w.pattern}`);

    expect(new Set(keys).size).toBe(keys.length);
  });

  it('los nombres de acción son constantes en mayúsculas, distinguibles de una genérica', () => {
    // Una genérica es `POST /ruta`. Si un nombre declarado tuviera espacios o
    // minúsculas, al consultar no se podría separar lo declarado de lo que cayó
    // al nombre por defecto.
    for (const action of [...AUDITED_READS, ...WRITE_ACTION_NAMES].map((entry) => entry.action)) {
      expect(action, `"${action}" debería ser MAYUSCULAS_CON_GUION_BAJO`).toMatch(/^[A-Z][A-Z0-9_]*$/);
    }
  });
});
