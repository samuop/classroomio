<script lang="ts">
  import { InputField } from '@cio/ui/custom/input-field';
  import { t } from '$lib/utils/functions/translations';
  import { snackbar } from '$features/ui/snackbar/store';

  interface Props {
    gradeMax?: number;
    disableGrading?: boolean;
    grade?: number | undefined;
  }

  /**
   * `grade` va SIN valor por defecto, y es a propósito.
   *
   * Con `$bindable(0)` esto se ataba a una prop con fallback, y Svelte 5
   * prohíbe `bind:` contra `undefined` en ese caso: tira `props_invalid_value`,
   * que no es un aviso sino un error de render. Quien corrige un envío hace
   * `bind:grade={notas[pregunta.id]}`, y alcanza UNA pregunta sin puntaje
   * registrado —una agregada después de que el alumno entregó— para que el
   * modal entero se caiga y en su lugar aparezca la pantalla de error.
   *
   * Sin fallback, además, la casilla sale vacía en vez de con un cero: "todavía
   * no la corregí" y "le puse cero" son cosas distintas y ahora se distinguen.
   * `InputField` ya declara su `value` sin fallback, así que el `undefined`
   * viaja hasta abajo sin romper nada.
   */
  let { gradeMax = 0, disableGrading = false, grade = $bindable() }: Props = $props();

  $effect(() => {
    if (grade && grade > gradeMax) {
      snackbar.error('grade cant be more than max value');
      grade = gradeMax;
    }
  });
</script>

<div class="flex items-center">
  <InputField
    placeholder={$t('course.navItem.lessons.exercises.new_exercise_modal.points')}
    bind:value={grade}
    max={gradeMax}
    type="number"
    inputClassName="!w-16"
    isDisabled={disableGrading}
  />

  <p class="ml-2 flex items-center text-base dark:text-white">
    <span class="mr-1">/</span> <span>{gradeMax}</span>
  </p>
</div>
