<script lang="ts">
  import { get } from 'svelte/store';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { Empty } from '@cio/ui/custom/empty';
  import LockIcon from '@lucide/svelte/icons/lock';
  import * as Page from '@cio/ui/base/page';
  import { ExercisePage } from '$features/course/pages';
  import { questionnaireMetaData, reset } from '$features/course/components/exercise/store';
  import { isOrgStudent } from '$lib/utils/store/app';
  import { t } from '$lib/utils/functions/translations';
  import { hydrateExercisePageData } from '$features/course/utils/exercise-page-utils';

  let { data = $bindable() } = $props();

  const path = `/courses/${data.courseId}/lessons`;
  const isLockedForStudent = $derived($isOrgStudent && data.exercise?.isUnlocked === false);

  $effect(() => {
    if (!data.exercise || isLockedForStudent) return;

    const meta = get(questionnaireMetaData);

    /**
     * Solo un ejercicio DISTINTO justifica tirar el intento que hay en curso.
     *
     * Antes habia una salida temprana mas: si el alumno ya habia terminado ESTE
     * ejercicio, no se cargaba nada. La idea era no pisarle el intento, pero
     * `hydrateExercisePageData` no toca las respuestas — solo llena el
     * cuestionario (titulo, preguntas, secciones). Lo unico que borra el intento
     * es `reset()`, y para eso ya esta la comparacion de abajo.
     *
     * Navegando desde el curso no se notaba: el store todavia tenia las
     * preguntas de la visita anterior, asi que saltear la carga era invisible. En
     * una RECARGA el store arranca vacio, la carga se salteaba igual, y el examen
     * aparecia sin preguntas — con la nota del alumno al lado sobre un total de
     * cero, porque el puntaje venia de la entrega y el total del cuestionario que
     * nunca se cargo.
     */
    if (meta.exerciseId != null && meta.exerciseId !== data.exerciseId) {
      reset();
    }

    hydrateExercisePageData(data.exercise, data.exerciseId);
  });
</script>

<Page.Root class="mx-auto flex w-full px-3 sm:w-[90%] sm:px-4 lg:max-w-5xl">
  {#if isLockedForStudent}
    <Empty
      title={$t('course.navItem.lessons.content_locked_title')}
      description={$t('course.navItem.lessons.content_locked_description')}
      icon={LockIcon}
      variant="page"
      class="text-center"
    />
  {:else}
    <ExercisePage
      exerciseId={data.exerciseId}
      goBack={() => goto(resolve(path, {}))}
      isFetching={false}
      submissions={data.submissions ?? []}
      mySubmissions={data.mySubmissions ?? []}
    />
  {/if}
</Page.Root>
