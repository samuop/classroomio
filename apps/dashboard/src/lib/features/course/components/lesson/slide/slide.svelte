<script lang="ts">
  import { lessonApi } from '$features/course/api';
  import { listPlacedLessonMediaIds, SLIDE_MEDIA_ID } from '$features/course/utils/lesson-media';
  import { diapositivaIncrustable } from '$features/course/utils/slide-embed';
  import { InputField } from '@cio/ui/custom/input-field';
  import { t } from '$lib/utils/functions/translations';
  import MODES from '$lib/utils/constants/mode';
  import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';

  interface Props {
    mode?: (typeof MODES)[keyof typeof MODES];
    lessonId?: string;
  }

  let { mode = MODES.view, lessonId = '' }: Props = $props();

  /** Placed inside the note? Then the note renders it, and this block stands down. */
  const isPlacedInNote = $derived(
    listPlacedLessonMediaIds(lessonApi.translations[lessonId]?.[lessonApi.currentLocale]).has(SLIDE_MEDIA_ID)
  );

  /** Se guarda el enlace tal como lo pegó el docente; lo que se incrusta se deriva al mostrarlo. */
  const enlace = $derived(lessonApi.lesson?.slideUrl || '');
  const diapositiva = $derived(diapositivaIncrustable(enlace));

  const url = $derived(isPlacedInNote ? undefined : diapositiva?.url);
</script>

{#if mode === MODES.edit}
  <div class="flex flex-col gap-4">
    <!--
      Sin `name`, el campo toma el id genérico `input-field`, el mismo que el título
      de la lección: el rótulo apuntaba al título y un clic en él lo enfocaba.
    -->
    <InputField
      name="slide-url"
      label={$t('course.navItem.lessons.materials.tabs.slide.slide_link')}
      value={enlace}
      placeholder={$t('course.navItem.lessons.materials.tabs.slide.placeholder')}
      onInputChange={(e) => {
        lessonApi.updateLessonState('slideUrl', e.currentTarget.value);
      }}
      errorMessage={enlace.trim() && !diapositiva ? $t('course.navItem.lessons.materials.tabs.slide.invalid') : ''}
      helperMessage={$t('course.navItem.lessons.materials.tabs.slide.helper_message')}
    />

    {#if diapositiva?.proveedor === 'otro'}
      <p class="flex items-start gap-2 text-sm text-amber-700 dark:text-amber-400">
        <TriangleAlertIcon size={16} class="mt-0.5 shrink-0" />
        {$t('course.navItem.lessons.materials.tabs.slide.unsupported')}
      </p>
    {/if}

    <!--
      Lo que va a ver el estudiante, antes de salir del editor. Sin esto, la única
      forma de saber si el enlace funcionaba era guardar la lección y mirarla.
      Con otro sitio no: el navegador bloquea el marco y queda un recuadro vacío
      que parece un error de la plataforma; el aviso de arriba ya lo explica.
    -->
    {#if diapositiva && diapositiva.proveedor !== 'otro'}
      <div class="flex flex-col gap-2">
        <p class="ui:text-muted-foreground text-xs font-medium">
          {$t('course.navItem.lessons.materials.tabs.slide.preview')}
        </p>
        <!-- `iframe.iframe` lo centra; en el editor va alineado con el campo. -->
        <iframe title="Embeded Slides" src={diapositiva.url} frameborder="0" class="iframe mx-0!" allowfullscreen={true}
        ></iframe>
      </div>
    {/if}
  </div>
{:else}
  <!-- View Mode -->
  {#if url}
    <!-- Sizing lives in `iframe.iframe` (app.css): 16:9 at every width. -->
    <iframe title="Embeded Slides" src={url} frameborder="0" class="iframe my-3" allowfullscreen={true}></iframe>
  {/if}
{/if}
