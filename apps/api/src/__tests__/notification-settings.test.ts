/**
 * El catálogo de avisos y la resolución de lo guardado sobre los defaults.
 *
 * Es la pieza que decide si un correo sale o no, y falla en silencio en las dos
 * direcciones: de más molesta a todo el mundo, de menos deja a un tutor sin
 * enterarse de que hay entregas esperando. Nadie revisa una bandeja para
 * descubrir lo que NO llegó, así que el caso peligroso —y el que más se afirma
 * acá— es el silencio no pedido.
 */
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_NOTIFICATION_SETTINGS,
  NOTIFICATION_CATALOG,
  NOTIFICATION_IDS,
  ZNotificationSettings,
  notificationsFor,
  resolveNotificationSettings
} from '@cio/utils/validation/notifications';

describe('el catálogo', () => {
  it('no tiene ids repetidos', () => {
    const ids = NOTIFICATION_CATALOG.map((n) => n.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it('cubre exactamente los ids declarados, sin faltantes ni sobrantes', () => {
    // Las dos listas se escriben a mano y es fácil agregar a una sola. Un id sin
    // entrada en el catálogo se queda sin default y sin lugar en la pantalla.
    expect(NOTIFICATION_CATALOG.map((n) => n.id).sort()).toEqual([...NOTIFICATION_IDS].sort());
  });

  it('le da un valor por omisión a todos', () => {
    for (const id of NOTIFICATION_IDS) {
      expect(typeof DEFAULT_NOTIFICATION_SETTINGS[id]).toBe('boolean');
    }
  });

  it('viene todo encendido de fábrica', () => {
    // Una instalación nueva no debería estrenarse muda. Si algún día un aviso
    // nace apagado, que sea una decisión y no un descuido: este test la obliga
    // a pasar por acá.
    expect(Object.values(DEFAULT_NOTIFICATION_SETTINGS).every(Boolean)).toBe(true);
  });

  it('reparte todos los avisos entre alumnos y equipo', () => {
    const repartidos = notificationsFor('student').length + notificationsFor('team').length;

    expect(repartidos).toBe(NOTIFICATION_IDS.length);
  });

  it('marca como difusión los que van a más de una persona', () => {
    const difusion = NOTIFICATION_CATALOG.filter((n) => n.broadcast).map((n) => n.id);

    // El aviso del muro va a todo el curso; los otros dos, a todo el equipo.
    // Es el dato que explica por qué alguien querría apagarlos.
    expect(difusion.sort()).toEqual(['exerciseSubmitted', 'newsfeedPost', 'studentJoinedCourse']);
  });
});

describe('resolveNotificationSettings', () => {
  it('sin nada guardado devuelve los defaults', () => {
    expect(resolveNotificationSettings(null)).toEqual(DEFAULT_NOTIFICATION_SETTINGS);
    expect(resolveNotificationSettings(undefined)).toEqual(DEFAULT_NOTIFICATION_SETTINGS);
    expect(resolveNotificationSettings({})).toEqual(DEFAULT_NOTIFICATION_SETTINGS);
  });

  it('respeta un apagado guardado', () => {
    const resuelto = resolveNotificationSettings({ exerciseSubmitted: false });

    expect(resuelto.exerciseSubmitted).toBe(false);
  });

  it('no toca los demás al apagar uno', () => {
    const resuelto = resolveNotificationSettings({ exerciseSubmitted: false });

    expect(resuelto.newsfeedPost).toBe(true);
    expect(resuelto.courseCompleted).toBe(true);
  });

  it('nunca deja un aviso sin valor', () => {
    // Un `undefined` que llegue a la compuerta se leería como falso y apagaría
    // el aviso sin que nadie lo haya pedido. Ese es el bug a evitar.
    const resuelto = resolveNotificationSettings({ newsfeedPost: false });

    for (const id of NOTIFICATION_IDS) {
      expect(typeof resuelto[id]).toBe('boolean');
    }
  });

  it('trata la clave ausente como "nunca lo tocaron", no como apagado', () => {
    const resuelto = resolveNotificationSettings({ newsfeedPost: undefined });

    expect(resuelto.newsfeedPost).toBe(true);
  });

  it('ignora basura guardada en vez de apagar el aviso', () => {
    // Si alguna vez entra un valor que no es booleano —una migración a medias,
    // un PUT viejo— la respuesta correcta es seguir mandando, no callarse.
    //
    // Los valores FALSY son los que importan, y por eso están todos: con basura
    // verdadera (`'no'`) cualquier implementación descuidada acierta de casualidad,
    // porque `Boolean('no')` ya es `true`. La primera versión de este test usaba
    // justamente eso y no detectó un `Boolean(value)` en lugar de un chequeo de
    // tipo — que convierte `''` y `0` en un apagado que nadie pidió.
    for (const basura of ['', 0, null, NaN]) {
      const resuelto = resolveNotificationSettings({ newsfeedPost: basura as never });

      expect(resuelto.newsfeedPost).toBe(true);
    }
  });

  it('no inventa claves que no estén en el catálogo', () => {
    const resuelto = resolveNotificationSettings({ inventado: true } as never);

    expect(Object.keys(resuelto).sort()).toEqual([...NOTIFICATION_IDS].sort());
  });
});

describe('el validador del PUT', () => {
  it('acepta un parche de un solo aviso', () => {
    expect(ZNotificationSettings.safeParse({ newsfeedPost: false }).success).toBe(true);
  });

  it('acepta el objeto vacío', () => {
    expect(ZNotificationSettings.safeParse({}).success).toBe(true);
  });

  it('rechaza un valor que no sea booleano', () => {
    expect(ZNotificationSettings.safeParse({ newsfeedPost: 'false' }).success).toBe(false);
    expect(ZNotificationSettings.safeParse({ newsfeedPost: 0 }).success).toBe(false);
  });

  it('descarta claves desconocidas en vez de guardarlas', () => {
    const parsed = ZNotificationSettings.safeParse({ newsfeedPost: false, loQueSea: true });

    expect(parsed.success).toBe(true);
    if (parsed.success) expect('loQueSea' in parsed.data).toBe(false);
  });
});
