<script lang="ts">
  import type { Editor } from '@tiptap/core';
  import * as DropdownMenu from '$src/base/dropdown-menu';
  import Heading from '@lucide/svelte/icons/heading';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import commands from '../../../commands/toolbar-commands';
  import { cn } from '$src/tools';
  import EdraToolTip from '../EdraToolTip.svelte';
  import Paragraph from '@lucide/svelte/icons/pilcrow';
  import { buttonVariants } from '$src/base/button';
  import { createEditorVersion } from '../../editor-version.svelte';

  interface Props {
    editor: Editor;
  }

  const { editor }: Props = $props();

  const headings = commands['headings'];

  // Sin esto el ícono se queda con el encabezado que hubiera al montar: TipTap
  // muta su estado sin avisarle a Svelte. Ver `createEditorVersion`.
  const version = createEditorVersion(() => editor);

  const activeHeading = $derived.by(() => {
    void version.current;

    return headings.find((h) => h.isActive?.(editor));
  });

  const isActive = $derived(activeHeading !== undefined);

  const HeadingIcon = $derived(activeHeading ? activeHeading.icon : Heading);
</script>

<DropdownMenu.Root>
  <DropdownMenu.Trigger>
    <EdraToolTip tooltip="Títulos">
      <div
        class={buttonVariants({
          variant: 'ghost',
          size: 'icon',
          class: cn('ui:gap-0')
        })}
        class:bg-muted={isActive}
      >
        <HeadingIcon />
        <ChevronDown class="ui:text-muted-foreground !size-2" />
      </div>
    </EdraToolTip>
  </DropdownMenu.Trigger>
  <DropdownMenu.Content portalProps={{ to: undefined, disabled: true }}>
    <DropdownMenu.Item onclick={() => editor.chain().focus().setParagraph().run()}>
      <Paragraph />
      <span>Paragraph</span>
    </DropdownMenu.Item>
    {#each headings as heading (heading)}
      {@const Icon = heading.icon}
      <DropdownMenu.Item onclick={() => heading.onClick?.(editor)}>
        <Icon />
        <span>{heading.tooltip}</span>
      </DropdownMenu.Item>
    {/each}
  </DropdownMenu.Content>
</DropdownMenu.Root>
