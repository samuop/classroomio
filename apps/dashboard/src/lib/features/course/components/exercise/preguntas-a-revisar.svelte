<script lang="ts">
  /**
   * Las preguntas de este ejercicio cuyo fundamento ya no está en las lecciones.
   *
   * Medido (2026-11): las lecciones de un curso cambiaron y sus cuestionarios
   * siguieron preguntando lo viejo, sin que nada lo dijera. Cada pregunta que
   * escribe el asistente guarda la frase de la lección de la que salió; si esa
   * frase ya no está en ninguna lección, la respuesta puede haber quedado mal.
   * El servidor lo mide contra las lecciones de ahora (`preguntas-a-revisar.ts`),
   * así que también ve lo que se cambió a mano.
   *
   * Sólo para el equipo del curso. Si no se puede preguntar, no se muestra nada:
   * un aviso que falla no tiene que tapar el editor.
   */
  import { classroomio } from '$lib/utils/services/api';
  import { t } from '$lib/utils/functions/translations';

  interface Props {
    courseId: string;
    exerciseId: string;
    locale: string;
  }

  let { courseId, exerciseId, locale }: Props = $props();

  interface PreguntaARevisar {
    exerciseId: string;
    questionId: string;
    questionTitle: string;
    evidence: string;
  }

  let preguntas = $state<PreguntaARevisar[]>([]);

  $effect(() => {
    const curso = courseId;
    const ejercicio = exerciseId;
    const idioma = locale;
    let vigente = true;

    preguntas = [];

    (async () => {
      try {
        const respuesta = await classroomio.agent['questions-to-review'].$get({ query: { courseId: curso, locale: idioma } });
        const resultado = (await respuesta.json()) as { success?: boolean; data?: { questions?: PreguntaARevisar[] } };

        if (!vigente || !resultado?.success) return;

        preguntas = (resultado.data?.questions ?? []).filter((pregunta) => pregunta.exerciseId === ejercicio);
      } catch {
        // Sin el aviso: el editor sigue igual.
      }
    })();

    return () => {
      vigente = false;
    };
  });
</script>

{#if preguntas.length > 0}
  <div
    role="note"
    class="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/30 dark:text-amber-200"
  >
    <p class="font-medium">{$t('course.navItem.lessons.exercises.questions_to_review.title', { count: preguntas.length })}</p>
    <p class="mt-1 text-xs">{$t('course.navItem.lessons.exercises.questions_to_review.body')}</p>
    <ul class="mt-2 list-disc space-y-1 pl-5 text-xs">
      {#each preguntas as pregunta (pregunta.questionId)}
        <li>
          <span class="font-medium">{pregunta.questionTitle}</span>
          — {$t('course.navItem.lessons.exercises.questions_to_review.based_on', { evidence: pregunta.evidence })}
        </li>
      {/each}
    </ul>
  </div>
{/if}
