import { describe, expect, it, vi } from 'vitest';

import { QUESTION_TYPE_KEY, scoreAnswerForQuestion } from '../src';
import type { ExerciseQuestionModel } from '../src';

/**
 * El corrector buscaba la opción cuya etiqueta fuera literalmente `'true'` o
 * `'false'`. En español las etiquetas son «Verdadero» y «Falso», así que no
 * encontraba ninguna y caía en un `else` que daba por correcto el Verdadero sin
 * mirar qué opción estaba marcada.
 *
 * Medido en producción: 60 de 61 preguntas V/F caían ahí, y en 31 la respuesta
 * correcta era «Falso». Comprobado rindiendo un cuestionario: contestar
 * «Verdadero» a una pregunta cuya respuesta es «Falso» daba el punto.
 */
function preguntaVF(
  opciones: Array<{ label: string; isCorrect?: boolean }>,
  settings?: Record<string, unknown>
): ExerciseQuestionModel {
  return {
    id: 1,
    title: '¿Es así?',
    questionType: QUESTION_TYPE_KEY.TRUE_FALSE,
    points: 1,
    options: opciones.map((o, i) => ({ id: i + 1, ...o })),
    settings
  };
}

const RESPONDE_VERDADERO = { type: 'TRUE_FALSE', value: true } as const;
const RESPONDE_FALSO = { type: 'TRUE_FALSE', value: false } as const;

describe('corrección de Verdadero/Falso en español', () => {
  const enEspanol = [
    { label: 'Verdadero', isCorrect: false },
    { label: 'Falso', isCorrect: true }
  ];

  it('el que contesta Falso cuando la respuesta es Falso suma', () => {
    expect(scoreAnswerForQuestion(preguntaVF(enEspanol), RESPONDE_FALSO)).toBe(1);
  });

  /** El caso exacto que se midió en producción: éste daba 1 punto. */
  it('el que contesta Verdadero cuando la respuesta es Falso NO suma', () => {
    expect(scoreAnswerForQuestion(preguntaVF(enEspanol), RESPONDE_VERDADERO)).toBe(0);
  });

  it('y al revés, con Verdadero como respuesta correcta', () => {
    const conVerdadero = [
      { label: 'Verdadero', isCorrect: true },
      { label: 'Falso', isCorrect: false }
    ];

    expect(scoreAnswerForQuestion(preguntaVF(conVerdadero), RESPONDE_VERDADERO)).toBe(1);
    expect(scoreAnswerForQuestion(preguntaVF(conVerdadero), RESPONDE_FALSO)).toBe(0);
  });

  /**
   * Hay preguntas cuya opción explica la respuesta en la misma etiqueta. Lo que
   * decide es la primera palabra; el resto es la explicación.
   */
  it('lee la primera palabra aunque la etiqueta siga explicando', () => {
    const conExplicacion = [
      { label: 'Falso: el sistema no lo hace solo, hay que confirmarlo a mano', isCorrect: true },
      { label: 'Verdadero: el sistema lo detecta sin intervención de nadie', isCorrect: false }
    ];

    expect(scoreAnswerForQuestion(preguntaVF(conExplicacion), RESPONDE_FALSO)).toBe(1);
    expect(scoreAnswerForQuestion(preguntaVF(conExplicacion), RESPONDE_VERDADERO)).toBe(0);
  });

  it('no se marea con el orden: la respuesta la da isCorrect, no la posición', () => {
    const falsoPrimero = [
      { label: 'Falso', isCorrect: false },
      { label: 'Verdadero', isCorrect: true }
    ];

    expect(scoreAnswerForQuestion(preguntaVF(falsoPrimero), RESPONDE_VERDADERO)).toBe(1);
    expect(scoreAnswerForQuestion(preguntaVF(falsoPrimero), RESPONDE_FALSO)).toBe(0);
  });

  it('sigue funcionando en inglés, que es lo que había antes', () => {
    const enIngles = [
      { label: 'True', isCorrect: false },
      { label: 'False', isCorrect: true }
    ];

    expect(scoreAnswerForQuestion(preguntaVF(enIngles), RESPONDE_FALSO)).toBe(1);
    expect(scoreAnswerForQuestion(preguntaVF(enIngles), RESPONDE_VERDADERO)).toBe(0);
  });

  it('settings.correctValue le gana a las etiquetas', () => {
    const contradictoria = [
      { label: 'Verdadero', isCorrect: true },
      { label: 'Falso', isCorrect: false }
    ];

    expect(scoreAnswerForQuestion(preguntaVF(contradictoria, { correctValue: false }), RESPONDE_FALSO)).toBe(1);
    expect(scoreAnswerForQuestion(preguntaVF(contradictoria, { correctValue: false }), RESPONDE_VERDADERO)).toBe(0);
  });

  /**
   * Si la pregunta no dice cuál es su respuesta, el error es del autor. Adivinar
   * en silencio es justamente lo que rompió esto: acá se avisa y no se le cobra
   * al alumno.
   */
  it('cuando ninguna opción está marcada, avisa y no penaliza', () => {
    const avisos = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const sinMarcar = [{ label: 'Verdadero' }, { label: 'Falso' }];

    expect(scoreAnswerForQuestion(preguntaVF(sinMarcar), RESPONDE_FALSO)).toBe(1);
    expect(scoreAnswerForQuestion(preguntaVF(sinMarcar), RESPONDE_VERDADERO)).toBe(1);
    expect(avisos).toHaveBeenCalled();

    avisos.mockRestore();
  });
});
