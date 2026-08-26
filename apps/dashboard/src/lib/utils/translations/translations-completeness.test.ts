import en from './en.json';
import es from './es.json';

/**
 * El español tiene que cubrir todo lo que existe en inglés.
 *
 * Por qué hace falta un test aparte del que renderiza la pantalla: el i18n está
 * configurado con `fallbackLocale: 'en'`, así que una clave que falta en español
 * **no se ve rota** — se ve en inglés. La pantalla funciona, nadie recibe un
 * error, y el resultado es una interfaz mitad y mitad que sólo nota quien la
 * usa. Es el único modo de falla del sistema de traducciones que ninguna otra
 * herramienta puede ver.
 *
 * Sólo se controla el español: es el idioma en el que está escrita la
 * aplicación. Los demás pueden ir atrasados sin que eso sea una falla.
 */

type Arbol = { [clave: string]: unknown };

/** Las hojas del árbol: `{ a: { b: 'x' } }` → `[['a.b', 'x']]`. */
function hojas(arbol: Arbol, prefijo = ''): Array<[string, unknown]> {
  return Object.entries(arbol).flatMap(([clave, valor]) =>
    valor !== null && typeof valor === 'object' && !Array.isArray(valor)
      ? hojas(valor as Arbol, `${prefijo}${clave}.`)
      : ([[`${prefijo}${clave}`, valor]] as Array<[string, unknown]>)
  );
}

describe('traducciones', () => {
  it('el español no se apoya en el inglés para ninguna clave', () => {
    const enEspanol = new Set(hojas(es as Arbol).map(([clave]) => clave));
    const faltantes = hojas(en as Arbol)
      .map(([clave]) => clave)
      .filter((clave) => !enEspanol.has(clave));

    expect(faltantes).toEqual([]);
  });

  it('ninguna traducción quedó vacía', () => {
    // Una cadena vacía pasa el control de arriba y en pantalla es un hueco: un
    // botón sin texto, un título que no está.
    const vacias = hojas(es as Arbol)
      .filter(([, valor]) => typeof valor === 'string' && valor.trim() === '')
      .map(([clave]) => clave);

    expect(vacias).toEqual([]);
  });
});
