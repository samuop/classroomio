import { render } from '@testing-library/svelte';
import { QUESTION_TYPE_IDS } from '@cio/question-types';

import Preview from './preview.svelte';
import { getExerciseQuestionLabels } from './question-labels';
import { getQuestionAnswerKey } from './question-type-utils';

/**
 * La revisión de una verdadero/falso dice lo mismo que la nota.
 *
 * El corrector decide la respuesta por la opción marcada como correcta (arreglado
 * el 2026-09-16), pero la pantalla de revisión seguía mirando sólo
 * `settings.correctValue`, que ninguna pregunta de producción tiene, y daba por
 * correcto el Verdadero. Medido el 2026-11-02: en 100 preguntas cuya respuesta es
 * «Falso», quien contestaba bien recibía el punto y veía «Incorrecta», con el
 * Verdadero marcado como la correcta.
 *
 * Contra la vista real que el alumno ve al terminar (`preview.svelte` en modo
 * revisión), con los renderizadores reales.
 */

const ETIQUETAS = getExerciseQuestionLabels();
const VERDADERO = ETIQUETAS['true_false.true_label']!;
const FALSO = ETIQUETAS['true_false.false_label']!;
const CORRECTA = ETIQUETAS['common.correct_badge']!;
const INCORRECTA = ETIQUETAS['common.incorrect_badge']!;

/** Como llega de la API: la respuesta está en la opción marcada; `settings` trae sólo la cita. */
function preguntaVF(opciones: Array<{ id: number; label: string; isCorrect?: boolean }>) {
  return {
    id: 3,
    order: 1,
    title: 'Un pedido por mensaje personal cuenta como pedido.',
    points: 1,
    questionTypeId: QUESTION_TYPE_IDS.TRUE_FALSE,
    settings: { evidence: 'Un pedido por mensaje personal no cuenta como pedido.' },
    options: opciones
  } as never;
}

const RESPUESTA_FALSO = [
  { id: 31, label: 'Verdadero', isCorrect: false },
  { id: 32, label: 'Falso', isCorrect: true }
];

function revisar(pregunta: never, contesto: boolean | null) {
  const answers =
    contesto === null ? {} : { [getQuestionAnswerKey(pregunta)]: { type: 'TRUE_FALSE', value: contesto } };
  const { container } = render(Preview, {
    props: { questions: [pregunta], disableGrading: true, questionnaireMetaData: { answers, isFinished: true } }
  });

  /** Las insignias que muestra cada opción. */
  const insignias = (etiqueta: string) => {
    const opcion = [...container.querySelectorAll('button')].find((b) => b.textContent?.includes(etiqueta));
    expect(opcion, `la opción ${etiqueta}`).toBeTruthy();
    return [CORRECTA, INCORRECTA].filter((titulo) => opcion!.querySelector(`[title="${titulo}"]`));
  };

  return { verdadero: insignias(VERDADERO), falso: insignias(FALSO) };
}

it('quien contesta Falso a una pregunta cuya respuesta es Falso ve que acertó', () => {
  expect(revisar(preguntaVF(RESPUESTA_FALSO), false)).toEqual({ verdadero: [], falso: [CORRECTA] });
});

it('quien contesta Verdadero ve que se equivocó y cuál era la correcta', () => {
  expect(revisar(preguntaVF(RESPUESTA_FALSO), true)).toEqual({ verdadero: [INCORRECTA], falso: [CORRECTA] });
});

it('sigue andando cuando la respuesta es Verdadero', () => {
  const respuestaVerdadero = [
    { id: 31, label: 'Verdadero', isCorrect: true },
    { id: 32, label: 'Falso', isCorrect: false }
  ];

  expect(revisar(preguntaVF(respuestaVerdadero), true)).toEqual({ verdadero: [CORRECTA], falso: [] });
});

it('si al alumno no le llegó la respuesta, no marca ninguna como correcta', () => {
  // Un examen con reintento: de una pregunta que no contestó no recibe la clave.
  const sinClave = [
    { id: 31, label: 'Verdadero' },
    { id: 32, label: 'Falso' }
  ];

  expect(revisar(preguntaVF(sinClave), null)).toEqual({ verdadero: [], falso: [] });
});
