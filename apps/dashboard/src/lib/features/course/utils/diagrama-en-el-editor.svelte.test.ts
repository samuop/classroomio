import { describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { BlockId } from '@cio/ui/custom/editor/extensions/block-id/BlockId';
import { Svg } from '@cio/ui/custom/editor/extensions/svg/Svg';
import { sanitizeHtml } from '@cio/ui/tools/sanitize';

/**
 * ¿Cómo se le pone nombre a un diagrama para que sobreviva?
 *
 * ── Por qué se mide esto ─────────────────────────────────────────────────────
 *
 * Un `<svg>` de primer nivel era el único bloque de una lección sin
 * `data-block-id`, y eso costó caro: medido en producción el 2026-09-22, la
 * orden de trabajo señalaba un valor viejo que vivía DENTRO del diagrama, el
 * modelo no tenía cómo nombrarlo y terminó reemplazando el PÁRRAFO anterior por
 * «párrafo + svg nuevo», 7 y 10 veces seguidas. Quedaron 8 y 9 diagramas
 * idénticos y una lección pasó de 7,9 KB a 29,8 KB.
 *
 * Había tres salidas y una sola forma de elegir: medirlas. Un id que no
 * sobrevive es PEOR que ninguno — se reasigna en cada vuelta y termina
 * direccionando el bloque equivocado.
 *
 * ── Lo que este archivo midió ────────────────────────────────────────────────
 *
 *  1. Envolverlo en `<figure data-block-id>`: NO sobrevive. ProseMirror no
 *     tiene nodo `figure` y `figure` está en sus `blockTags`, así que lo
 *     atraviesa, parsea a sus hijos y el envoltorio —con su id— se pierde en el
 *     primer guardado desde el editor.
 *  2. Ponerle `data-block-id` al PROPIO `<svg>`: SÍ sobrevive. El nodo
 *     `svgBlock` guarda el markup crudo (`element.outerHTML`) y lo vuelve a
 *     escribir tal cual, así que un atributo que ya venía en el markup viaja
 *     adentro. (El comentario de `BlockId.ts` dice que un id ahí «nunca podría
 *     llegar a la base»: es cierto para un id que estampara la extensión por
 *     serialización de atributos, y falso para uno que ya está escrito en el
 *     HTML, que es el caso del servidor.)
 *  3. Y el sanitizador —que corre en CADA guardado de una lección, tanto en el
 *     dashboard como en la API, con esta misma configuración compartida— deja
 *     pasar el atributo.
 *
 * Por eso el servidor estampa el id en el `<svg>` mismo (ver `TIPOS_CON_ID` en
 * `lesson-blocks.ts`) en vez del id virtual `svg@<bloque anterior>`: un id de
 * verdad no se mueve cuando se edita el bloque de arriba, y hace del diagrama
 * un bloque común.
 *
 * ── El arnés ────────────────────────────────────────────────────────────────
 *
 * Las tres extensiones que deciden la respuesta: StarterKit (los bloques
 * comunes), `BlockId` (el que estampa y conserva `data-block-id`) y `Svg` (el
 * nodo que conserva el diagrama). Ninguna otra extensión del editor declara un
 * `figure` ni toca el svg — se verificó buscando «figure» en todo
 * `packages/ui/src/custom/editor`.
 */

const ETIQUETAS = '<text x="10" y="20">P2 Alta</text><text x="10" y="50">Primera respuesta: 2 horas</text>';

function idaYVuelta(html: string): string {
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: [StarterKit, BlockId, Svg],
    content: html
  });

  const guardado = editor.getHTML();
  editor.destroy();

  return guardado;
}

describe('un diagrama envuelto en <figure>', () => {
  it('pierde el envoltorio —y su id— al guardar desde el editor', () => {
    const guardado = idaYVuelta(
      '<p data-block-id="aaaa1111">Escalamiento de incidentes</p>' +
        `<figure data-block-id="bbbb2222"><svg width="240" height="90">${ETIQUETAS}</svg></figure>`
    );

    expect(guardado).not.toContain('bbbb2222');
    expect(guardado).not.toContain('<figure');
    // El diagrama sí sobrevive, suelto y sin nombre: ése era el problema.
    expect(guardado).toContain('<svg');
    expect(guardado).toContain('P2 Alta');
    expect(guardado).toContain('data-block-id="aaaa1111"');
  });
});

describe('un diagrama con data-block-id en el propio <svg>', () => {
  it('conserva su id al abrir y guardar desde el editor', () => {
    const guardado = idaYVuelta(
      '<p data-block-id="aaaa1111">Escalamiento de incidentes</p>' +
        `<svg data-block-id="d1a9ram0" width="240" height="90">${ETIQUETAS}</svg>`
    );

    expect(guardado).toContain('data-block-id="d1a9ram0"');
    expect(guardado).toContain('P2 Alta');
    expect(guardado).toContain('data-block-id="aaaa1111"');
  });

  it('y lo conserva al pasar por el sanitizador, que corre en cada guardado', () => {
    // La misma configuración (`createSanitizeHtmlConfig`) que usa la API en
    // `upsertLessonLanguageService`: si acá se cayera el atributo, el id no
    // llegaría nunca a la base.
    const limpio = sanitizeHtml(
      `<p data-block-id="aaaa1111">Escalamiento</p><svg data-block-id="d1a9ram0" width="240" height="90">${ETIQUETAS}</svg>`
    );

    expect(limpio).toContain('data-block-id="d1a9ram0"');
    expect(limpio).toContain('P2 Alta');
  });
});
