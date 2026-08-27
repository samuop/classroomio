import type { Editor } from '@tiptap/core';
import type { Transaction } from '@tiptap/pm/state';

/**
 * Hace visible para Svelte que el editor cambió.
 *
 * TipTap guarda su estado adentro de una instancia común y corriente y la muta
 * en el lugar: apretar una tecla, mover el cursor o aplicar una marca no tocan
 * ninguna señal de Svelte. Entonces cualquier `$derived` que pregunte
 * `editor.can()` o `editor.isActive()` se calcula UNA vez, al montar, y se
 * queda con esa respuesta para siempre.
 *
 * Eso es lo que dejó la barra de herramientas muerta: los botones de negrita,
 * cursiva, subrayado y tachado se evalúan contra la posición del cursor, y la
 * primera posición del documento suele ser un adjunto o una imagen —un nodo
 * donde una marca no se puede aplicar—, así que nacían deshabilitados y no se
 * volvían a habilitar nunca, ni al hacer clic dentro del texto.
 *
 * La biblioteca original resolvía esto reasignando la instancia entera en cada
 * transacción (`editor = undefined; editor = props.editor`), un truco de Svelte 4
 * que quedó comentado en la migración a Svelte 5 (commit `f5a4156c8`) y se llevó
 * puesta la barra. Reasignar además desmonta y vuelve a montar todo lo que
 * cuelga del editor en cada tecla. Un contador es la mitad del código y no
 * desmonta nada.
 *
 * Se llama una vez por componente que lee estado del editor. No se comparte a
 * propósito: el gasto real no son los oyentes (incrementar un número), sino los
 * `can()` que cada botón necesita recalcular igual, tenga contador propio o
 * compartido.
 */
export function createEditorVersion(getEditor: () => Editor | undefined | null) {
  let version = $state(0);

  $effect(() => {
    const editor = getEditor();

    if (!editor || editor.isDestroyed) {
      return;
    }

    const bump = ({ transaction }: { transaction: Transaction }) => {
      /**
       * Sólo lo que puede cambiar una respuesta.
       *
       * ProseMirror emite transacciones por cosas que a la barra no le mueven el
       * amperímetro (metadatos de plugins, por ejemplo). Las tres que sí importan:
       * el documento cambió, el cursor se movió, o cambiaron las marcas guardadas
       * —que es el caso de apretar negrita con el cursor sin selección, donde
       * nada se mueve pero el botón tiene que quedar encendido.
       */
      if (!transaction.docChanged && !transaction.selectionSet && !transaction.storedMarksSet) {
        return;
      }

      version += 1;
    };

    editor.on('transaction', bump);

    return () => {
      editor.off('transaction', bump);
    };
  });

  return {
    get current() {
      return version;
    }
  };
}
