<script lang="ts">
  import { Button, buttonVariants } from '$src/base/button';
  import * as Popover from '$src/base/popover';
  import type { Editor } from '@tiptap/core';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import { cn } from '$src/tools';
  import EdraToolTip from '../EdraToolTip.svelte';
  import { createEditorVersion } from '../../editor-version.svelte';

  interface Props {
    class?: string;
    editor: Editor;
  }
  const { class: className = '', editor }: Props = $props();

  const colors = [
    { label: 'Predeterminado', value: '' },
    { label: 'Azul', value: '#0000FF' },
    { label: 'Marrón', value: '#A52A2A' },
    { label: 'Verde', value: '#008000' },
    { label: 'Gris', value: '#808080' },
    { label: 'Naranja', value: '#FFA500' },
    { label: 'Rosa', value: '#FFC0CB' },
    { label: 'Violeta', value: '#800080' },
    { label: 'Rojo', value: '#FF0000' },
    { label: 'Amarillo', value: '#FFFF00' }
  ];

  // Ver `createEditorVersion`: sin esto los dos puntitos de color muestran para
  // siempre lo que hubiera bajo el cursor al montar el editor.
  const version = createEditorVersion(() => editor);

  const currentColor = $derived.by(() => {
    void version.current;

    return editor.getAttributes('textStyle').color;
  });

  const currentHighlight = $derived.by(() => {
    void version.current;

    return editor.getAttributes('highlight').color;
  });
</script>

<Popover.Root>
  <Popover.Trigger>
    <EdraToolTip tooltip="Colores">
      <div
        class={buttonVariants({
          variant: 'ghost',
          size: 'icon',
          class: cn('ui:gap-0.5', className)
        })}
        style={`color: ${currentColor}; background-color: ${currentHighlight}50;`}
      >
        <span>A</span>
        <ChevronDown class="ui:text-muted-foreground !size-2" />
      </div>
    </EdraToolTip>
  </Popover.Trigger>
  <Popover.Content class="ui:size-fit ui:shadow-lg" portalProps={{ disabled: true, to: undefined }}>
    <div class="ui:text-muted-foreground ui:my-2 ui:text-xs">Text Colors</div>
    <div class="ui:grid ui:gap-2 grid-cols-5">
      {#each colors as color (color)}
        <Button
          variant="ghost"
          class={cn(
            `size-6 border-0 p-0 font-normal`,
            editor.isActive('textStyle', { color: color.value }) && 'border-2 font-extrabold',
            color.value === '' && 'border'
          )}
          style={`color: ${color.value}; background-color: ${color.value}50; border-color: ${color.value};`}
          title={color.label}
          onclick={() => {
            if (color.value === '') editor.chain().focus().unsetColor().run();
            else
              editor
                .chain()
                .focus()
                .setColor(currentColor === color.value ? '' : color.value)
                .run();
          }}
        >
          A
        </Button>
      {/each}
    </div>
    <div class="ui:text-muted-foreground ui:my-2 ui:text-xs">Highlight Colors</div>
    <div class="ui:grid ui:gap-2 grid-cols-5">
      {#each colors as color (color)}
        <Button
          variant="ghost"
          class={cn(
            `size-6 border-0 p-0 font-normal`,
            editor.isActive('highlight', { color: color.value }) && 'border-2',
            color.value === '' && 'border'
          )}
          style={`background-color: ${color.value}50; border-color: ${color.value};`}
          title={color.label}
          onclick={() => {
            if (color.value === '') editor.chain().focus().unsetHighlight().run();
            else editor.chain().focus().toggleHighlight({ color: color.value }).run();
          }}>A</Button
        >
      {/each}
    </div>
  </Popover.Content>
</Popover.Root>
