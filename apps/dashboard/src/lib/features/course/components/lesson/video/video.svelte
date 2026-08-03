<script lang="ts">
  import { lessonApi } from '$features/course/api';
  import type { LessonMediaRef } from '@cio/utils/functions/lesson-media-id';
  import { listPlacedLessonMediaIds } from '$features/course/utils/lesson-media';
  import { DeleteModal } from '$features/ui';
  import { Button } from '@cio/ui/base/button';
  import { Empty } from '@cio/ui/custom/empty';
  import * as Item from '@cio/ui/base/item';
  import { lessonVideoUpload } from '$features/course/components/lesson/store';
  import { t } from '$lib/utils/functions/translations';
  import MODES from '$lib/utils/constants/mode';
  import VideoIcon from '@lucide/svelte/icons/video';
  import LessonVideoSimpleCard from './lesson-video-simple-card.svelte';
  import LessonVideoPlayer from './lesson-video-player.svelte';

  interface Props {
    mode?: (typeof MODES)[keyof typeof MODES];
    lessonId?: string;
  }

  let { mode = MODES.view, lessonId = '' }: Props = $props();

  const videos = $derived(lessonApi.lesson?.videos || []);

  /**
   * Videos the teacher placed inside the note render there, so this list leaves
   * them out — otherwise the student sees the same video twice. Edit mode still
   * shows all of them: that grid is how you manage the lesson's material, and a
   * video you cannot see is a video you cannot remove.
   */
  const placedMediaIds = $derived(
    listPlacedLessonMediaIds(lessonApi.translations[lessonId]?.[lessonApi.currentLocale])
  );
  const unplacedVideos = $derived(videos.filter((video) => !video.id || !placedMediaIds.has(video.id)));

  let openDeleteVideoModal = $state(false);
  let videoToDelete = $state<LessonMediaRef | null>(null);

  const openAddVideoModal = () => {
    $lessonVideoUpload.isModalOpen = true;
  };

  function requestRemoveVideo(ref: LessonMediaRef) {
    videoToDelete = ref;
    openDeleteVideoModal = true;
  }

  function confirmRemoveVideo() {
    if (videoToDelete) {
      lessonApi.deleteLessonVideo(videoToDelete);
      videoToDelete = null;
    }
    openDeleteVideoModal = false;
  }
</script>

{#snippet content(video)}
  {#key video.type === 'upload' ? ((video as typeof video & { assetId?: string }).assetId ?? video.link) : video.link}
    <LessonVideoPlayer {video} />
  {/key}
{/snippet}

{#if mode === MODES.edit}
  <!-- Edit Mode: grid of video cards with remove + delete confirmation -->
  <Button onclick={openAddVideoModal} class="float-end my-4">
    {$t('course.navItem.lessons.materials.tabs.video.button')}
  </Button>

  {#if videos.length}
    <Item.Group class="grid! w-full grid-cols-1 gap-x-5 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
      {#each videos as video, index (video.id ?? `${index}-${video.link}`)}
        <LessonVideoSimpleCard
          {video}
          {index}
          isEditMode={true}
          onRemove={() => requestRemoveVideo({ id: video.id, index })}
        />
      {/each}
    </Item.Group>
  {:else}
    <Empty
      title={$t('course.navItem.lessons.materials.tabs.video.empty_title')}
      description={$t('course.navItem.lessons.materials.tabs.video.empty_description')}
      icon={VideoIcon}
    />
  {/if}

  <DeleteModal bind:open={openDeleteVideoModal} onDelete={confirmRemoveVideo} />
{:else}
  <!-- View Mode -->
  {#if unplacedVideos.length}
    <div class="w-full">
      {#each unplacedVideos as video, index (video.id ?? `${index}-${video.link}`)}
        <div class="mb-5 w-full overflow-hidden">
          {@render content(video)}
        </div>
      {/each}
    </div>
  {/if}
{/if}
