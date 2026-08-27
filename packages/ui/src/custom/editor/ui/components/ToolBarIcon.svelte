<script lang="ts">
  import { Button } from '$src/base/button';
  import type { EdraToolBarCommands } from '../../commands/types';
  import type { Editor } from '@tiptap/core';
  import EdraToolTip from './EdraToolTip.svelte';
  import { cn } from '$src/tools';
  import { createEditorVersion } from '../editor-version.svelte';

  interface Props {
    editor: Editor;
    command: EdraToolBarCommands;
  }

  const { editor, command }: Props = $props();

  /**
   * `isActive` y `clickable` preguntan por el estado interno de TipTap, que
   * cambia sin avisarle a Svelte. Leer `version.current` es lo que ata estos
   * dos cálculos a cada transacción del editor; sin eso se congelan en la
   * respuesta que dieron al montar y el botón nunca se enciende ni se apaga.
   */
  const version = createEditorVersion(() => editor);

  const isActive = $derived.by(() => {
    void version.current;

    return command.isActive?.(editor) ?? false;
  });

  const disabled = $derived.by(() => {
    void version.current;

    return command.clickable ? !command.clickable(editor) : false;
  });
</script>

<EdraToolTip tooltip={command.tooltip ?? ''} shortCut={command.shortCut ?? ''}>
  <Button
    variant="ghost"
    size="icon"
    class={cn(isActive && 'bg-muted')}
    onclick={() => command.onClick?.(editor)}
    {disabled}
  >
    {@const Icon = command.icon}
    <Icon />
  </Button>
</EdraToolTip>
