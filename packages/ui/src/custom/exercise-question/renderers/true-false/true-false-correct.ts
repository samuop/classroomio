import { getTrueFalseCorrectValue, type ExerciseQuestionModel } from '@cio/question-types';

/**
 * Cuál es la respuesta de una verdadero/falso, con la misma regla con la que se
 * corrige. `undefined` cuando no se sabe: la pregunta no la declara, o al alumno
 * todavía no le llegó (ver la clave de respuestas en la API).
 *
 * Antes daba por correcto el Verdadero cuando faltaba `settings.correctValue`,
 * que es lo que pasa en todas las preguntas de producción: la respuesta está en
 * la opción marcada.
 */
export function getTrueFalseCorrectIsTrue(
  question: Pick<ExerciseQuestionModel, 'settings' | 'options'>
): boolean | undefined {
  return getTrueFalseCorrectValue(question);
}
