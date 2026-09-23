import { describe, expect, it } from 'vitest';

import {
  asignarIdsDeBloque,
  listLessonBlocks,
  listarElementosDePrimerNivel
} from '@api/services/agent/lesson-blocks';

/**
 * Los ids de bloque, puestos por el SERVIDOR.
 *
 * ── Qué se está fijando ──────────────────────────────────────────────────────
 *
 * Hasta acá los ponía sólo el editor TipTap del dashboard, cuando el docente
 * abría la lección y la guardaba. Una lección recién escrita por el asistente no
 * tenía ni uno, así que `replace_lesson_block` —el único camino que cambia un
 * dato sin reescribir la lección entera— no existía para ella. Medido: cada
 * corrección terminaba siendo una reescritura completa, y cada reescritura es
 * una tirada nueva de invenciones («preferentemente» volvió obligatorio en una).
 *
 * Las tres propiedades que hacen que esto sirva —y que, si se rompen, rompen
 * algo que nadie ve hasta que una edición pega en el bloque equivocado— son:
 * idempotencia, ids que no se reasignan, y todo lo que no es un tag de apertura
 * byte a byte igual.
 */

/** Un generador previsible: así el test puede escribir el resultado esperado. */
function contador() {
  let n = 0;

  return () => {
    n += 1;
    return `blq${n}`;
  };
}

const sinIds = (html: string) => html.replace(/ data-block-id="[^"]*"/g, '');

describe('los elementos de primer nivel', () => {
  it('los lista en orden, con su tramo', () => {
    const html = '<h3>Uno</h3><p>Dos</p>';

    expect(listarElementosDePrimerNivel(html).map((e) => e.tagName)).toEqual(['h3', 'p']);
    expect(listarElementosDePrimerNivel(html)[1].start).toBe('<h3>Uno</h3>'.length);
  });

  it('no cuenta lo que está anidado', () => {
    expect(listarElementosDePrimerNivel('<ul><li>Uno</li><li>Dos</li></ul>').map((e) => e.tagName)).toEqual(['ul']);
  });

  it('no se confunde con el mismo tag anidado', () => {
    const html = '<div><div>adentro</div>cola</div><p>después</p>';

    expect(listarElementosDePrimerNivel(html).map((e) => e.tagName)).toEqual(['div', 'p']);
  });

  it('ignora el texto suelto y los comentarios', () => {
    // Un comentario puede traer adentro algo con forma de elemento: contarlo lo
    // daría por parte del documento y le pondría un id a algo que no existe.
    const html = 'texto suelto<!-- <p>esto no está</p> --><p>esto sí</p>';

    expect(listarElementosDePrimerNivel(html).map((e) => e.tagName)).toEqual(['p']);
  });

  it('corta en un tag que nunca cierra en vez de seguir escaneando adentro', () => {
    // Seguir dejaría el cursor ADENTRO del elemento roto, y todo lo que viniera
    // después se reportaría como de primer nivel sin serlo.
    expect(listarElementosDePrimerNivel('<div>sin cerrar<p>adentro</p>')).toEqual([]);
  });
});

describe('asignar ids de bloque', () => {
  it('le pone uno a cada bloque de primer nivel que no lo tenga', () => {
    const resultado = asignarIdsDeBloque('<h3>Título</h3><p>Párrafo</p>', contador());

    expect(resultado).toBe('<h3 data-block-id="blq1">Título</h3><p data-block-id="blq2">Párrafo</p>');
  });

  it('es idempotente: una segunda pasada no cambia un byte', () => {
    // Con el generador de verdad y no con el contador: si la segunda pasada
    // reasignara, con ids aleatorios se nota, y con un contador que arranca de
    // cero volvería a dar lo mismo y el test pasaría con el defecto puesto.
    const primera = asignarIdsDeBloque('<h3>Título</h3><ul><li>Uno</li></ul>');

    expect(asignarIdsDeBloque(primera)).toBe(primera);
  });

  /**
   * La regla que el editor se puso a sí mismo: un id que cambia entre la lectura
   * y la escritura es peor que no tener id. El modelo copia un blockId de
   * `get_lesson_content` y lo usa dos pasos después.
   */
  it('conserva los ids que ya estaban', () => {
    const html = '<p data-block-id="viejo">Ya tenía</p><p>Nuevo</p>';

    expect(asignarIdsDeBloque(html, contador())).toBe(
      '<p data-block-id="viejo">Ya tenía</p><p data-block-id="blq1">Nuevo</p>'
    );
  });

  it('renumera un id repetido, porque dos bloques con un nombre hacen ambiguo el empalme', () => {
    const html = '<p data-block-id="x">Uno</p><p data-block-id="x">Dos</p>';
    const resultado = asignarIdsDeBloque(html, contador());

    expect(resultado).toBe('<p data-block-id="x">Uno</p><p data-block-id="blq1">Dos</p>');
    expect(listLessonBlocks(resultado).map((b) => b.blockId)).toEqual(['x', 'blq1']);
  });

  it('trata un id vacío como ausente: no direcciona nada', () => {
    expect(asignarIdsDeBloque('<p data-block-id="">Sin id</p>', contador())).toBe(
      '<p data-block-id="blq1">Sin id</p>'
    );
  });

  /**
   * El `<svg>` SÍ lleva id, contra lo que decía este test.
   *
   * Estaba excluido por una suposición: «el editor lo entrega crudo a
   * ProseMirror, así que un id acá no llegaría nunca a la base». Medido con el
   * editor de verdad (`apps/dashboard/.../diagrama-en-el-editor.svelte.test.ts`),
   * es al revés: el nodo `svgBlock` guarda el markup crudo y lo vuelve a
   * escribir tal cual, así que un id que ya viene en el HTML sobrevive — y el
   * sanitizador lo deja pasar.
   *
   * Lo que costó la suposición: el diagrama era el único bloque sin nombre, y
   * el modelo terminó pegando 8 y 9 copias del mismo dibujo tratando de
   * corregir un valor de adentro (2026-09-22).
   */
  it('le pone id a un <svg> de primer nivel, que es lo que lo hace direccionable', () => {
    const html = '<p>Antes</p><svg viewBox="0 0 10 10"><text>A</text></svg><p>Después</p>';
    const resultado = asignarIdsDeBloque(html, contador());

    expect(resultado).toContain('<svg viewBox="0 0 10 10" data-block-id="blq2">');
    expect(listLessonBlocks(resultado).map((b) => b.blockId)).toEqual(['blq1', 'blq2', 'blq3']);
  });

  it('no le pone id a los elementos anidados', () => {
    // Con un `<p>` adentro de un `<div>` a propósito: los dos son tipos que
    // reciben id, así que si el escaneo se metiera adentro, el de adentro
    // también saldría marcado — y un id anidado multiplica los ids sin hacer
    // nada más direccionable.
    const resultado = asignarIdsDeBloque('<div><p>Uno</p></div>', contador());

    expect(resultado).toBe('<div data-block-id="blq1"><p>Uno</p></div>');
  });

  it('tampoco a los ítems de una lista', () => {
    expect(asignarIdsDeBloque('<ul><li>Uno</li><li>Dos</li></ul>', contador())).toBe(
      '<ul data-block-id="blq1"><li>Uno</li><li>Dos</li></ul>'
    );
  });

  it('deja todo lo que no es un tag de apertura byte a byte igual', () => {
    // Entidades, comillas tipográficas, un comentario, un diagrama y texto
    // suelto: lo que un reprocesado por DOM reescribiría sin avisar.
    const html =
      '<h3>Bienvenida &amp; cierre</h3>' +
      '<!-- una nota del docente -->' +
      '<p>Dijo “hola” y se fue.</p>' +
      '<svg viewBox="0 0 10 10"><text>A</text></svg>' +
      '<blockquote data-sin-fuente="la fuente no lo dice">Algo mío.</blockquote>';

    expect(sinIds(asignarIdsDeBloque(html, contador()))).toBe(html);
  });

  it('un bloque vacío o sin bloques no se rompe', () => {
    expect(asignarIdsDeBloque('', contador())).toBe('');
    expect(asignarIdsDeBloque('sólo texto suelto', contador())).toBe('sólo texto suelto');
  });

  it('un elemento sin cierre no le mete ids a lo que tiene adentro', () => {
    expect(asignarIdsDeBloque('<div>sin cerrar<p>adentro</p>', contador())).toBe('<div>sin cerrar<p>adentro</p>');
  });

  it('el id generado sale del formato del editor: ocho caracteres', () => {
    const resultado = asignarIdsDeBloque('<p>Uno</p>');
    const [bloque] = listLessonBlocks(resultado);

    expect(bloque.blockId).toHaveLength(8);
    expect(bloque.blockId).toMatch(/^[a-z0-9]+$/i);
  });

  it('un generador que repite no deja dos bloques con el mismo id', () => {
    // El empalme por id pegaría siempre en el primero de los dos, y el segundo
    // bloque quedaría fuera de alcance para siempre.
    const resultado = asignarIdsDeBloque('<p>Uno</p><p>Dos</p><p>Tres</p>', () => 'igual');
    const ids = listLessonBlocks(resultado).map((b) => b.blockId);

    expect(new Set(ids).size).toBe(3);
  });

  it('el resultado es direccionable: los ids se pueden volver a leer', () => {
    const resultado = asignarIdsDeBloque('<h3>T</h3><p>Uno</p><hr>', contador());

    expect(listLessonBlocks(resultado).map((b) => b.blockId)).toEqual(['blq1', 'blq2', 'blq3']);
  });
});
