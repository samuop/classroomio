import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';

import { sanitizeHtml } from '@cio/ui/tools/sanitize';

/**
 * Lo que le pasa al formato entre "estoy editando" y "dejé de editar".
 *
 * La nota se guarda como HTML y la vista de lectura la vuelve a inyectar con
 * `{@html}`, así que hay exactamente dos maneras de perder una negrita: que la
 * etiqueta no sobreviva el camino, o que sobreviva y no tenga estilo. Son
 * arreglos opuestos, y sin medirlo se elige el equivocado.
 *
 * Este archivo fija la primera mitad: las etiquetas llegan enteras.
 */

function htmlDe(aplicar: (editor: Editor) => void): string {
  const element = document.createElement('div');
  document.body.appendChild(element);

  const editor = new Editor({
    element,
    content: '<p>colorimetría</p>',
    extensions: [StarterKit.configure({ codeBlock: false })]
  });

  editor.chain().focus().selectAll().run();
  aplicar(editor);

  const html = editor.getHTML();

  editor.destroy();

  return html;
}

it('el saneador no se come el formato del editor', () => {
  const negrita = sanitizeHtml(htmlDe((editor) => editor.chain().focus().toggleBold().run()));
  const subrayado = sanitizeHtml(htmlDe((editor) => editor.chain().focus().toggleUnderline().run()));
  const tachado = sanitizeHtml(htmlDe((editor) => editor.chain().focus().toggleStrike().run()));
  const título = sanitizeHtml(htmlDe((editor) => editor.chain().focus().toggleHeading({ level: 2 }).run()));

  expect(negrita).toContain('<strong>');
  expect(subrayado).toContain('<u>');
  expect(tachado).toContain('<s>');
  expect(título).toContain('<h2>');
});

it('deja pasar el estilo en línea, que es como viajan el color y el tamaño de letra', () => {
  // `style` no está en FORBID_ATTR a propósito: color y tamaño de letra de la
  // barra son `<span style="...">` y sin ese atributo desaparecerían sin ruido.
  const coloreado = sanitizeHtml('<p><span style="color: #FF0000">rojo</span></p>');

  expect(coloreado).toContain('style');
  expect(coloreado).toContain('#FF0000');
});
