<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { createEventDispatcher } from 'svelte';
  import { HTMLRender } from '$features/ui';
  import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
  import { Button } from '@cio/ui/base/button';
  import PlayIcon from '@lucide/svelte/icons/play';
  import { lessonApi } from '$features/course/api';
  import { diffLines } from 'diff';
  import { courseApi } from '$features/course/api';
  import { SafeHtmlContent } from '@cio/ui/custom/safe-html-content';
  import { t } from '$lib/utils/functions/translations';
  import { formatDisplayDateTime } from '$lib/utils/functions/date';

  import { snackbar } from '$features/ui/snackbar/store';
  import type { TLocale } from '@cio/db/types';

  interface LessonHistory {
    new_content: string;
    old_content: string;
    timestamp: Date;
    locale: TLocale;
    lesson_id: string;
  }

  interface Props {
    open?: boolean;
  }

  let { open = false }: Props = $props();
  let lessonHistory: LessonHistory[] = $state([]);
  let content = '';
  let selectedVersion: LessonHistory = {
    new_content: '',
    old_content: '',
    timestamp: new Date(),
    locale: 'en',
    lesson_id: ''
  };
  let selectedVersionIndex = $state(0);
  let contentRestoreLoading = $state(false);
  let versionsToFetch = $state(9);
  let isMoreHistoryLoading = $state(false);

  let mounted = false;

  const lessonId = $derived(lessonApi.lesson?.id || '');
  const lessonTitle = $derived(lessonApi.lesson?.title || '');

  const dispatch = createEventDispatcher();

  function scrollLock(open) {
    if (mounted) {
      const body = document.querySelector('body');
      if (!body) return;

      body.style.overflow = open ? 'hidden' : 'auto';
    }
  }

  function formatTimestamp(timestamp: string | Date) {
    // El backend manda UTC sin sufijo; el helper lo pasa a hora argentina.
    const raw = typeof timestamp === 'string' && !timestamp.endsWith('Z') ? `${timestamp}Z` : timestamp;
    return formatDisplayDateTime(raw instanceof Date ? raw.toISOString() : raw);
  }

  function handleDrawerClose() {
    dispatch('close');
  }

  function handleWindowKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && open) handleDrawerClose();
  }

  /**
   * Identidad de una version = su instante exacto.
   *
   * Antes se comparaba `getMinutes()`, que es el minuto DEL RELOJ (0-59): dos
   * versiones separadas por una hora, o por un dia, que cayeran en el mismo
   * minuto se descartaban entre si. Con el historial lleno habria tirado casi
   * todo y dejado como mucho 60 entradas.
   */
  function versionKey(time: Date | string) {
    return new Date(time).getTime();
  }

  function removeDuplicate(history: LessonHistory[]) {
    const seen: Record<number, true> = {};

    return history.filter((entry) => {
      const key = versionKey(entry.timestamp);
      if (seen[key]) return false;
      seen[key] = true;
      return true;
    });
  }

  function fetchLessonHistory(lessonId: string, locale: TLocale, endRange: number) {
    untrack(async () => {
      try {
        isMoreHistoryLoading = true;

        if (!courseApi.course?.id) {
          throw new Error('Course ID not available');
        }

        const response = await lessonApi.getHistory(courseApi.course?.id, lessonId, locale, endRange);

        if (!response || !lessonApi.success || !response.data) {
          throw new Error('Failed to fetch lesson history');
        }

        const data = response.data;

        const toLessonHistory = (item: (typeof data)[number]): LessonHistory => ({
          old_content: item.oldContent ?? '',
          new_content: item.newContent ?? '',
          timestamp: item.timestamp ? new Date(item.timestamp) : new Date(),
          locale: (item.locale as TLocale) ?? 'en',
          lesson_id: item.lessonId ?? ''
        });

        const existingTimestamps: Record<number, true> = {};
        for (const item of lessonHistory) existingTimestamps[versionKey(item.timestamp)] = true;

        const newEntries = data
          .filter((item) => !existingTimestamps[versionKey(item.timestamp ?? 0)])
          .map(toLessonHistory);
        lessonHistory = removeDuplicate([...lessonHistory, ...newEntries]);

        if (lessonHistory.length > 0) {
          updateContentVersion(lessonHistory[0], 0);
        }
      } catch (error) {
        console.error(error);
        snackbar.error('Failed to fetch history');
      } finally {
        isMoreHistoryLoading = false;
      }
    });
  }

  onMount(() => {
    mounted = true;
    scrollLock(open);
  });

  function updateContentVersion(content: LessonHistory, index: number) {
    selectedVersionIndex = index;
    selectedVersion = content;
    const display = document.getElementById('display');
    display!.innerHTML = '';

    const diff = diffLines(content.old_content, content.new_content);
    const fragment = document.createDocumentFragment();

    diff.forEach((part) => {
      const span = document.createElement('span');
      if (part.added) {
        span.classList.add('text-green-500');
      } else if (part.removed) {
        span.classList.add('text-red-500', 'line-through');
      } else {
        span.classList.add('text-black', 'dark:text-white');
      }
      span.innerHTML = part.value;
      fragment.appendChild(span);
    });

    display!.appendChild(fragment);
  }

  async function restoreSelectedVersion() {
    try {
      contentRestoreLoading = true;
      if (!courseApi.course?.id || !selectedVersion) return;

      await lessonApi.upsertLanguage(
        courseApi.course.id,
        selectedVersion.lesson_id,
        selectedVersion.locale,
        selectedVersion.new_content
      );
    } catch (error) {
      console.error(error);
      snackbar.error('Failed to restore');
    } finally {
      contentRestoreLoading = false;
      dispatch('restore');
    }
  }

  function loadMoreHistory() {
    versionsToFetch += 10;
  }

  $effect(() => {
    scrollLock(open);
  });
  $effect(() => {
    fetchLessonHistory(lessonId, lessonApi.currentLocale, versionsToFetch);
  });
</script>

<svelte:window onkeydown={handleWindowKeydown} />

<aside class="drawer bg-gray-100 dark:bg-neutral-800" class:open>
  <div class="panel bg-white dark:bg-black">
    <div class="w-full p-10 pr-80">
      <!--
        Fijo y por encima de todo. El panel es `position: fixed` de ancho completo
        arrancando en x=0, asi que su esquina superior izquierda cae DEBAJO del
        sidebar del curso, que se pinta encima: el boton de volver existia y era
        intocable, y no habia ninguna otra forma de salir salvo recargar. Ahora
        vive arriba a la derecha, sobre el panel, y Escape tambien cierra.
      -->
      <div class="fixed top-4 right-4 z-20 flex items-start gap-x-3">
        <Button variant="outline" onclick={handleDrawerClose} aria-label="Cerrar">
          <ArrowLeftIcon size={16} />
        </Button>

        {#if selectedVersionIndex != 0}
          <div class="">
            <Button loading={contentRestoreLoading} onclick={restoreSelectedVersion}>
              {$t('course.navItem.lessons.version_history.restore_version')}
            </Button>
          </div>
        {/if}
      </div>
      <div class="flex h-full w-full flex-col items-start">
        <HTMLRender className="m-auto text-center mt-6 flex items-center justify-center">
          <h1 class="mt-0 text-2xl capitalize md:text-4xl">
            {lessonTitle}
          </h1>
        </HTMLRender>

        {#key lessonId}
          <HTMLRender id="display" className="m-auto">
            <div class="amen">
              <SafeHtmlContent {content} />
            </div>
          </HTMLRender>
        {/key}
      </div>
    </div>
  </div>
  <div
    id="scroll-container"
    class="fixed top-0 right-0 z-10 h-full min-h-screen w-80 space-y-6 overflow-x-auto overflow-y-scroll bg-gray-100 py-10 dark:bg-neutral-800"
  >
    <p class="flex items-start justify-start px-10 text-left text-xl font-medium">
      {$t('course.navItem.lessons.version_history.title')}
    </p>

    <div>
      {#each lessonHistory as version, index (index)}
        <button
          onclick={() => updateContentVersion(version, index)}
          class="flex w-full cursor-pointer items-start p-4 px-10 hover:bg-gray-200 dark:hover:bg-neutral-700 {index ==
          selectedVersionIndex
            ? 'bg-gray-200 dark:bg-neutral-700'
            : ''}"
        >
          <PlayIcon size={16} class="mt-1" />
          <div>
            <span class="inline-block text-base font-medium">{formatTimestamp(version.timestamp)}</span>
            {#if index == 0}
              <span class="block text-start text-xs italic"
                >{$t('course.navItem.lessons.version_history.current_version')}</span
              >
            {/if}
          </div>
        </button>
      {/each}
      <div class="mt-2 flex h-10 items-center justify-start px-10">
        <Button loading={isMoreHistoryLoading} onclick={loadMoreHistory}>
          {$t('course.navItem.lessons.version_history.fetch_more_versions')}
        </Button>
      </div>
    </div>
  </div>
</aside>

<style>
  .drawer {
    position: fixed;
    top: 0;
    left: 0;
    height: 100%;
    width: 100%;
    z-index: -1;
  }

  .drawer.open {
    z-index: 99;
  }

  .panel {
    position: fixed;
    width: 100%;
    height: 100%;
    z-index: 3;
    overflow: auto;
  }

  .drawer.open .panel {
    transform: translate(0, 0);
  }
</style>
