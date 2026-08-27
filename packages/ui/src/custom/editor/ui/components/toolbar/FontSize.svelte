<script lang="ts">
  import { Button } from '$src/base/button';
  import * as DropdownMenu from '$src/base/dropdown-menu';
  import { Editor } from '@tiptap/core';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import { cn } from '$src/tools';
  import EdraToolTip from '../EdraToolTip.svelte';
  import { createEditorVersion } from '../../editor-version.svelte';

  interface Props {
    class?: string;
    editor: Editor;
  }

  const { class: className = '', editor }: Props = $props();

  const FONT_SIZE = [
    { label: 'Mínima', value: '0.7rem' },
    { label: 'Menor', value: '0.75rem' },
    { label: 'Chica', value: '0.9rem' },
    { label: 'Normal', value: '' },
    { label: 'Grande', value: '1.25rem' },
    { label: 'Enorme', value: '1.5rem' }
  ];

  // Ver `createEditorVersion`: `getAttributes` lee estado que TipTap muta sin
  // avisarle a Svelte, así que la etiqueta se congelaba al montar.
  const version = createEditorVersion(() => editor);

  let currentSize = $derived.by(() => {
    void version.current;

    return editor.getAttributes('textStyle').fontSize || '';
  });

  const currentLabel = $derived.by(() => {
    const l = FONT_SIZE.find((f) => f.value === currentSize);
    if (l) return l.label;
    return 'Normal';
  });
</script>

<DropdownMenu.Root>
  <DropdownMenu.Trigger>
    <EdraToolTip tooltip="Tamaño de letra">
      <Button variant="ghost" class={cn('ui:gap-0.5 !px-2', className)}>
        <span>{currentLabel}</span>
        <ChevronDown class="ui:text-muted-foreground !size-2" />
      </Button>
    </EdraToolTip>
  </DropdownMenu.Trigger>
  <DropdownMenu.Content class="ui:h-fit ui:w-fit" portalProps={{ disabled: true, to: undefined }}>
    {#each FONT_SIZE as fontSize (fontSize)}
      <DropdownMenu.Item
        onclick={() => {
          editor.chain().focus().setFontSize(fontSize.value).run();
        }}
        style={`font-size: ${fontSize.value}`}>{fontSize.label}</DropdownMenu.Item
      >
    {/each}
  </DropdownMenu.Content>
</DropdownMenu.Root>
