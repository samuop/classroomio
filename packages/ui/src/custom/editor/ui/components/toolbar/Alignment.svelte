<script lang="ts">
  import * as DropdownMenu from '$src/base/dropdown-menu';
  import commands from '../../../commands/toolbar-commands';
  import type { Editor } from '@tiptap/core';
  import AlignLeft from '@lucide/svelte/icons/align-left';
  import EdraToolTip from '../EdraToolTip.svelte';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import { buttonVariants } from '$src/base/button';
  import { cn } from '$src/tools';
  import { createEditorVersion } from '../../editor-version.svelte';

  interface Props {
    editor: Editor;
  }
  const { editor }: Props = $props();

  const alignments = commands['alignment'];

  // Ver `createEditorVersion`: sin esta dependencia el ícono queda clavado en la
  // alineación que hubiera al montar.
  const version = createEditorVersion(() => editor);

  const activeAlignment = $derived.by(() => {
    void version.current;

    return alignments.find((alignment) => alignment.isActive?.(editor));
  });

  const isActive = $derived(activeAlignment !== undefined);

  const AlignMentIcon = $derived(activeAlignment ? activeAlignment.icon : AlignLeft);
</script>

<DropdownMenu.Root>
  <DropdownMenu.Trigger>
    <EdraToolTip tooltip="Alineación">
      <div
        class={buttonVariants({
          variant: 'ghost',
          size: 'icon',
          class: cn('ui:gap-0')
        })}
        class:bg-muted={isActive}
      >
        <AlignMentIcon />
        <ChevronDown class="ui:text-muted-foreground !size-2" />
      </div>
    </EdraToolTip>
  </DropdownMenu.Trigger>
  <DropdownMenu.Content portalProps={{ disabled: true, to: undefined }}>
    {#each alignments as alignment (alignment)}
      {@const Icon = alignment.icon}
      <DropdownMenu.Item onclick={() => alignment.onClick?.(editor)}>
        <Icon />
        <span>{alignment.tooltip}</span>
        <DropdownMenu.Shortcut>
          {alignment.shortCut}
        </DropdownMenu.Shortcut>
      </DropdownMenu.Item>
    {/each}
  </DropdownMenu.Content>
</DropdownMenu.Root>
