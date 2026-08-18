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
  import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
  import LessonVideoSimpleCard from './lesson-video-simple-card.svelte';

  interface Props {
    mode?: (typeof MODES)[keyof typeof MODES];
    lessonId?: string;
  }

  let { mode = MODES.view, lessonId = '' }: Props = $props();

  const videos = $derived(lessonApi.lesson?.videos || []);

  /**
   * La nota manda sobre lo que ve el alumno.
   *
   * Un video se muestra donde el docente puso su marcador, y en ningun otro
   * lado. Antes, uno SIN marcador se dibujaba igual — y como la lista de
   * pestanas arranca por Video, aparecia ARRIBA del texto de la leccion. De ahi
   * salia el video fantasma: borras el bloque de la nota y el video reaparece
   * solo, antes de la leccion, sin nada en la nota que borrar.
   *
   * Separar las dos cosas es lo que ademas hace posible el mismo video en varios
   * lugares: la pestana Video guarda el ARCHIVO (uno), la nota guarda las
   * UBICACIONES (las que quieras). Sacar una ubicacion no puede borrar el
   * archivo, y borrar el archivo se lleva todas sus ubicaciones.
   *
   * En edicion se siguen viendo todos, marcados: un video que no ves es un video
   * que no podes sacar.
   */
  const placedMediaIds = $derived(
    listPlacedLessonMediaIds(lessonApi.translations[lessonId]?.[lessonApi.currentLocale])
  );
  const isPlaced = (video: { id?: string }) => !!video.id && placedMediaIds.has(video.id);
  const unplacedCount = $derived(videos.filter((video) => !isPlaced(video)).length);

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

{#if mode === MODES.edit}
  <!-- Edit Mode: grid of video cards with remove + delete confirmation -->
  <Button onclick={openAddVideoModal} class="float-end my-4">
    {$t('course.navItem.lessons.materials.tabs.video.button')}
  </Button>

  {#if videos.length}
    {#if unplacedCount > 0}
      <!--
        Sin esto, un video sin ubicar es invisible para el alumno y el docente no
        tiene forma de enterarse: el aviso es la contraparte de haber sacado el
        auto-mostrado.
      -->
      <div
        class="mb-4 flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300"
      >
        <TriangleAlertIcon size={16} class="mt-0.5 shrink-0" />
        <p>{$t('course.navItem.lessons.materials.tabs.video.unplaced_warning', { count: unplacedCount })}</p>
      </div>
    {/if}

    <Item.Group class="grid! w-full grid-cols-1 gap-x-5 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
      {#each videos as video, index (video.id ?? `${index}-${video.link}`)}
        <LessonVideoSimpleCard
          {video}
          {index}
          isEditMode={true}
          isUnplaced={!isPlaced(video)}
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
{/if}
