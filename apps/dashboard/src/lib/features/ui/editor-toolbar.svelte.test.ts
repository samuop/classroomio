import { render } from '@testing-library/svelte';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { tick } from 'svelte';

import ToolBarIcon from '@cio/ui/custom/editor/ui/components/ToolBarIcon.svelte';
import commands from '@cio/ui/custom/editor/commands/toolbar-commands';

/**
 * Los botones de la barra del editor, montados contra un TipTap de verdad.
 *
 * Este archivo existe por un error que ninguna herramienta podía ver: negrita,
 * cursiva, subrayado y tachado salían deshabilitados y **nunca** se habilitaban,
 * ni haciendo clic dentro del texto. No era el comando, que estaba bien escrito:
 * era que TipTap muta su estado adentro de una instancia común y Svelte 5 no se
 * entera, así que `editor.can()` se contestaba una sola vez, al montar.
 *
 * Un test que no mueva el cursor pasa igual con el error adentro. Lo que muerde
 * acá es mover el cursor DESPUÉS de montar y exigir que el botón cambie.
 */

const bold = commands['text-formatting'].find((command) => command.name === 'bold')!;

let editor: Editor;

function crearEditor(content: string) {
  const element = document.createElement('div');
  document.body.appendChild(element);

  editor = new Editor({
    element,
    content,
    extensions: [StarterKit.configure({ codeBlock: false })]
  });

  return editor;
}

/**
 * El botón DEL COMPONENTE, que es el de ADENTRO: EdraToolTip envuelve todo en
 * otro <button>, el disparador del tooltip, que no lleva ni clases ni disabled.
 * Y `screen` tampoco sirve: el editor de TipTap vive en el
 * mismo `body` y trae sus propios elementos interactivos.
 */
function montarBotón() {
  const { container } = render(ToolBarIcon, { props: { editor, command: bold } });

  return () => container.querySelector<HTMLButtonElement>('button[data-slot="button"]')!;
}

afterEach(() => {
  editor?.destroy();
});

it('enciende el botón cuando la marca queda aplicada', async () => {
  crearEditor('<p>colorimetría</p>');
  const botón = montarBotón();

  editor.chain().focus().selectAll().run();
  await tick();

  expect(botón().className).not.toContain('bg-muted');

  editor.chain().focus().toggleBold().run();
  await tick();

  expect(botón().className).toContain('bg-muted');
});

it('vuelve a habilitarse al mover el cursor a donde la marca sí se puede aplicar', async () => {
  // El síntoma que se reportó, reproducido: el documento arranca con un nodo
  // donde una marca no entra —un adjunto, una imagen, una línea— así que el
  // botón nace deshabilitado. Con el estado congelado se quedaba así para
  // siempre.
  crearEditor('<hr><p>colorimetría</p>');
  const botón = montarBotón();

  editor.chain().focus().setNodeSelection(0).run();
  await tick();

  expect(botón().disabled).toBe(true);

  editor.chain().focus().setTextSelection({ from: 2, to: 13 }).run();
  await tick();

  expect(botón().disabled).toBe(false);
});
