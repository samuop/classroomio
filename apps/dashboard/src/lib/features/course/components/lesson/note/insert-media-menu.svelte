<script lang="ts">
  /**
   * Places one of the lesson's own videos, slides or documents at the cursor.
   *
   * This lives in the dashboard rather than the shared editor toolbar because it
   * needs to know which media THIS lesson has, which the editor package has no
   * way to reach. The teacher picks; the note gets an inert marker at the caret,
   * and the reading view mounts the real player there.
   */
  import * as DropdownMenu from '@cio/ui/base/dropdown-menu';
  import { Button } from '@cio/ui/base/button';
  import FileTextIcon from '@lucide/svelte/icons/file-text';
  import PlusIcon from '@lucide/svelte/icons/plus';
  import PresentationIcon from '@lucide/svelte/icons/presentation';
  import VideoIcon from '@lucide/svelte/icons/video';
  import type { TiptapEditor } from '@cio/ui/custom/editor';
  import { lessonApi } from '$features/course/api';
  import { listLessonMedia, type LessonMediaItem } from '$features/course/utils/lesson-media';
  import { t } from '$lib/utils/functions/translations';

  interface Props {
    editor?: TiptapEditor;
  }

  let { editor }: Props = $props();

  const items = $derived(listLessonMedia(lessonApi.lesson));

  const KIND_ICON = { video: VideoIcon, slide: PresentationIcon, document: FileTextIcon };

  function insert(item: LessonMediaItem) {
    if (!editor || editor.isDestroyed) return;

    // `focus()` first: the click moved focus to the menu, and without restoring
    // it the node lands at the document start instead of where the caret was.
    editor.chain().focus().setLessonMedia({ kind: item.kind, mediaId: item.mediaId }).run();
  }
</script>

<!--
  Stays enabled with nothing to offer, so opening it can explain why. A greyed-out
  button leaves the teacher guessing whether the feature is broken or the lesson
  is simply empty.
-->
<DropdownMenu.Root>
  <DropdownMenu.Trigger disabled={!editor}>
    {#snippet child({ props })}
      <Button {...props} variant="outline" size="sm" disabled={!editor}>
        <PlusIcon size={16} />
        {$t('course.navItem.lessons.materials.tabs.note.insert_media')}
      </Button>
    {/snippet}
  </DropdownMenu.Trigger>
  <DropdownMenu.Content align="end" class="max-h-80 w-72 overflow-y-auto">
    {#if items.length === 0}
      <DropdownMenu.Label class="text-muted-foreground text-sm font-normal">
        {$t('course.navItem.lessons.materials.tabs.note.insert_media_empty')}
      </DropdownMenu.Label>
    {:else}
      {#each items as item (item.kind + item.mediaId)}
        {@const Icon = KIND_ICON[item.kind]}
        <DropdownMenu.Item onclick={() => insert(item)}>
          <Icon size={16} />
          <span class="truncate">{item.label}</span>
        </DropdownMenu.Item>
      {/each}
    {/if}
  </DropdownMenu.Content>
</DropdownMenu.Root>
