<script lang="ts">
  /**
   * Places one of the lesson's own videos, slides or documents at the cursor —
   * and, when the lesson does not have the file yet, uploads it from right here.
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
  import UploadIcon from '@lucide/svelte/icons/upload';
  import VideoIcon from '@lucide/svelte/icons/video';
  import type { TiptapEditor } from '@cio/ui/custom/editor';
  import type { LessonMediaKind } from '@cio/ui/tools/sanitize';
  import { lessonApi } from '$features/course/api';
  import { listLessonMedia, type LessonMediaItem } from '$features/course/utils/lesson-media';
  import { lessonDocUpload, lessonVideoUpload } from '$features/course/components/lesson/store';
  import { t } from '$lib/utils/functions/translations';

  interface Props {
    editor?: TiptapEditor;
  }

  let { editor }: Props = $props();

  const items = $derived(listLessonMedia(lessonApi.lesson));

  const KIND_ICON = { video: VideoIcon, slide: PresentationIcon, document: FileTextIcon };

  function place(kind: LessonMediaKind, mediaId: string, at?: number) {
    if (!editor || editor.isDestroyed) return;

    // `focus()` first: the click moved focus to the menu, and without restoring
    // it the node lands at the document start instead of where the caret was.
    // With a position, it also restores a caret the upload dialog took away.
    editor.chain().focus(at).setLessonMedia({ kind, mediaId }).run();
  }

  function insert(item: LessonMediaItem) {
    place(item.kind, item.mediaId);
  }

  /**
   * An upload started from inside the note, waiting for its file to land.
   *
   * Adding a video used to be two journeys through two tabs — upload it over in
   * the Video tab, come back to the Note tab, then place it — with the teacher
   * holding the position in their head across both. Starting the upload from the
   * caret and dropping the marker where it was closes that loop.
   *
   * `pos` is captured before the dialog opens because the dialog takes focus and
   * the selection with it. `count` is what tells us the upload finished: every
   * one of the five ways to add a video (YouTube, embed, upload, library, Drive)
   * ends in the same append to lesson state, so watching the array grow catches
   * all of them without touching any.
   */
  interface PendingUpload {
    field: 'videos' | 'documents';
    kind: LessonMediaKind;
    pos: number;
    count: number;
  }

  let pending = $state<PendingUpload | null>(null);

  function mediaList(field: PendingUpload['field']) {
    const list = field === 'videos' ? lessonApi.lesson?.videos : lessonApi.lesson?.documents;
    return Array.isArray(list) ? list : [];
  }

  function startUpload(field: PendingUpload['field']) {
    if (!editor || editor.isDestroyed) return;

    pending = {
      field,
      kind: field === 'videos' ? 'video' : 'document',
      pos: editor.state.selection.from,
      count: mediaList(field).length
    };

    if (field === 'videos') {
      $lessonVideoUpload.isModalOpen = true;
    } else {
      $lessonDocUpload.isModalOpen = true;
    }
  }

  $effect(() => {
    const waiting = pending;
    if (!waiting) return;

    const list = mediaList(waiting.field);
    const isDialogOpen = waiting.field === 'videos' ? $lessonVideoUpload.isModalOpen : $lessonDocUpload.isModalOpen;

    if (list.length <= waiting.count) {
      // Closed with nothing added — the teacher changed their mind. Forget the
      // caret rather than leaving it armed to fire on some unrelated later upload.
      if (!isDialogOpen) pending = null;
      return;
    }

    const added = list[list.length - 1] as { id?: string } | undefined;
    pending = null;

    // No id means the entry is not addressable yet and a marker would point at
    // nothing; the material list still shows it, so nothing is lost by skipping.
    if (added?.id) place(waiting.kind, added.id, waiting.pos);
  });
</script>

<!--
  Stays enabled with nothing to offer, so opening it can explain why — and now
  it always has something to offer, because uploading is one of the options.
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
      <DropdownMenu.Separator />
    {/if}
    <DropdownMenu.Item onclick={() => startUpload('videos')}>
      <UploadIcon size={16} />
      <span class="truncate">{$t('course.navItem.lessons.materials.tabs.note.insert_media_add_video')}</span>
    </DropdownMenu.Item>
    <DropdownMenu.Item onclick={() => startUpload('documents')}>
      <UploadIcon size={16} />
      <span class="truncate">{$t('course.navItem.lessons.materials.tabs.note.insert_media_add_document')}</span>
    </DropdownMenu.Item>
  </DropdownMenu.Content>
</DropdownMenu.Root>
