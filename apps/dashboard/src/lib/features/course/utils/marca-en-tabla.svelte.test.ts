import { describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Table, TableRow, TableCell, TableHeader } from '@cio/ui/custom/editor/extensions/table';
import { Ejemplo } from '@cio/ui/custom/editor/extensions/ejemplo/Ejemplo';
import { SinFuente } from '@cio/ui/custom/editor/extensions/sin-fuente/SinFuente';
import { sanitizeHtml } from '@cio/ui/tools/sanitize';

/**
 * Una tabla de ejemplo tiene que poder llevar su marca y conservarla.
 *
 * ── Por qué ──────────────────────────────────────────────────────────────────
 *
 * Los datos de planilla van en una `<table>` (regla de las lecciones). En un
 * curso de planillas lo típico es una tabla de ejemplo —productos, precios,
 * «500 ml»—, y la marca `data-ejemplo` no sobrevivía en una tabla: TipTap tira
 * todo atributo que ninguna extensión declara, y la tabla no estaba en la lista.
 * Esos datos quedaban siempre sin marcar y el chequeo los devolvía como
 * inventados sin explicación.
 *
 * El arnés es el del editor de verdad: StarterKit, la tabla del editor y las dos
 * marcas, más el sanitizador que corre en cada guardado.
 */

function idaYVuelta(html: string): string {
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: [StarterKit, Table, TableRow, TableHeader, TableCell, Ejemplo, SinFuente],
    content: html
  });

  const salida = editor.getHTML();

  editor.destroy();

  return sanitizeHtml(salida);
}

const TABLA =
  '<table data-ejemplo="precios inventados para practicar"><tbody>' +
  '<tr><th><p>Producto</p></th><th><p>Precio</p></th></tr>' +
  '<tr><td><p>Gaseosa 500ml</p></td><td><p>1.200</p></td></tr>' +
  '</tbody></table>';

describe('la marca en una tabla', () => {
  it('data-ejemplo sobrevive al editor y al sanitizador', () => {
    expect(idaYVuelta(TABLA)).toContain('data-ejemplo="precios inventados para practicar"');
  });

  it('data-sin-fuente también', () => {
    const conHueco = TABLA.replace('data-ejemplo="precios inventados para practicar"', 'data-sin-fuente="el material no da precios"');

    expect(idaYVuelta(conHueco)).toContain('data-sin-fuente="el material no da precios"');
  });
});
