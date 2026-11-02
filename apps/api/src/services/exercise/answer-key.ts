import { QUESTION_TYPE_IDS, type AnswerData } from '@cio/question-types';
import { getAnswersOfProfileForExercise } from '@cio/db/queries/submission';

/**
 * La clave de respuestas de un cuestionario no le llega al alumno antes de entregar.
 *
 * Hasta 2026-11-02 la API le mandaba al navegador del alumno, junto con las
 * preguntas, cuál era la opción correcta de cada una (`isCorrect`), el valor de
 * las numéricas (`correctValue`, `tolerance`) y la cita de la fuente que justifica
 * la respuesta (`evidence`). La pantalla no los mostraba mientras contestaba, pero
 * quien abriera las herramientas del navegador los leía.
 *
 * La regla, decidida con el usuario:
 *
 *  - Antes de entregar: nada de la clave.
 *  - Entregó y el ejercicio no admite otro intento: la clave entera, porque la
 *    revisión le marca cuál era la correcta de cada pregunta.
 *  - Entregó y puede volver a intentar (los exámenes finales): sólo lo que ya le
 *    dijeron sus intentos corregidos. Si acertó o no en las opciones que eligió, y
 *    la respuesta de las verdadero/falso que contestó (con dos opciones, saber si
 *    acertó ES saber la respuesta). Nunca la correcta que no eligió: rendiría de
 *    nuevo con las respuestas a la vista.
 *
 * El equipo del curso no pasa por acá: arma el cuestionario y ve todo.
 */

/**
 * Lo que en `settings` de una pregunta es la respuesta y no hace falta para
 * contestarla. Quedan los ajustes con los que se arma la pregunta: las parejas de
 * unir, los elementos de ordenar y los puntos de la imagen, que el alumno necesita
 * para contestar (y que no hay en ningún cuestionario de producción).
 */
const ANSWER_SETTINGS = ['correctValue', 'tolerance', 'acceptedAnswers', 'correctAnswers', 'evidence'] as const;

/** Con estas el banco de palabras arma las fichas que el alumno arrastra. */
const ANSWER_SETTINGS_NEEDED_TO_ANSWER: Partial<Record<number, readonly string[]>> = {
  [QUESTION_TYPE_IDS.WORD_BANK]: ['correctAnswers']
};

type Option = { id: number | string; isCorrect?: boolean };
type Question = {
  id: number | string;
  questionTypeId: number;
  settings?: Record<string, unknown> | null;
  options?: Option[];
};
type ExerciseWithAnswerKey = {
  id: string;
  isComplete?: boolean;
  allowMultipleAttempts?: boolean | null;
  questions?: Question[];
  sections?: Array<{ questions?: Question[] }>;
};

/** Lo que el alumno ya supo por sus intentos corregidos. */
export interface KnownAnswers {
  /** Opciones que eligió en algún intento: de ésas ya sabe si eran correctas. */
  optionIds: Set<number>;
  /** Verdadero/falso que contestó en algún intento: ya sabe la respuesta. */
  trueFalseQuestionIds: Set<number>;
}

export const NOTHING_KNOWN: KnownAnswers = { optionIds: new Set(), trueFalseQuestionIds: new Set() };

export function knownAnswersFrom(
  answers: Array<{ questionId: number; answerData: AnswerData | null | undefined }>
): KnownAnswers {
  const known: KnownAnswers = { optionIds: new Set(), trueFalseQuestionIds: new Set() };

  for (const { questionId, answerData } of answers) {
    if (answerData?.type === 'RADIO') known.optionIds.add(Number(answerData.optionId));
    if (answerData?.type === 'CHECKBOX') answerData.optionIds.forEach((id) => known.optionIds.add(Number(id)));
    if (answerData?.type === 'TRUE_FALSE') known.trueFalseQuestionIds.add(Number(questionId));
  }

  return known;
}

export function questionWithoutAnswerKey<T extends Question>(question: T, known: KnownAnswers): T {
  if (question.questionTypeId === QUESTION_TYPE_IDS.TRUE_FALSE && known.trueFalseQuestionIds.has(Number(question.id))) {
    return question;
  }

  const keep = ANSWER_SETTINGS_NEEDED_TO_ANSWER[question.questionTypeId] ?? [];
  const settings = question.settings ? { ...question.settings } : question.settings;
  if (settings) {
    for (const key of ANSWER_SETTINGS) {
      if (!keep.includes(key)) delete settings[key];
    }
  }

  return {
    ...question,
    settings,
    options: question.options?.map((option) => {
      if (known.optionIds.has(Number(option.id))) return option;

      const { isCorrect: _isCorrect, ...withoutKey } = option;
      return withoutKey;
    })
  };
}

export function exerciseWithoutAnswerKey<T extends ExerciseWithAnswerKey>(exercise: T, known: KnownAnswers): T {
  const strip = (questions?: Question[]) => questions?.map((question) => questionWithoutAnswerKey(question, known));

  return {
    ...exercise,
    questions: strip(exercise.questions),
    sections: exercise.sections?.map((section) => ({ ...section, questions: strip(section.questions) }))
  };
}

/** El ejercicio como lo recibe un alumno (ver la regla arriba). */
export async function exerciseForStudent<T extends ExerciseWithAnswerKey>(exercise: T, profileId: string): Promise<T> {
  if (!exercise.isComplete) return exerciseWithoutAnswerKey(exercise, NOTHING_KNOWN);
  if (!exercise.allowMultipleAttempts) return exercise;

  const answers = await getAnswersOfProfileForExercise(exercise.id, profileId);
  return exerciseWithoutAnswerKey(exercise, knownAnswersFrom(answers));
}
