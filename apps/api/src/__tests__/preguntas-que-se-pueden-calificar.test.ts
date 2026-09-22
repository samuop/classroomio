import { describe, expect, it } from 'vitest';

import { QUESTION_TYPE_IDS } from '@cio/question-types';
import { ZExerciseCreate, ZExerciseUpdate } from '@cio/utils/validation/exercise';
import { createExerciseParam, questionSchema } from '@api/services/agent/agent-tool-schemas';

/**
 * Una pregunta numérica guarda su respuesta en `settings.correctValue`. Si no
 * está, el corrector le pone CERO a todo el mundo, responda lo que responda, y
 * nada avisa. Medido en producción: 3 de 27 numéricas quedaron así, dos de ellas
 * con la respuesta metida en una opción — que para este tipo no se lee.
 *
 * El prompt ya lo pedía en negrita. Pedirlo no es lo mismo que impedirlo.
 */
const NUMERICA = QUESTION_TYPE_IDS.NUMERIC;
const OPCION_MULTIPLE = QUESTION_TYPE_IDS.RADIO;

/**
 * Toda pregunta lleva además su `evidence`: la frase de la lección que evalúa,
 * que el servidor busca antes de crear nada. Ver `evidencia-de-preguntas.ts`.
 */
function preguntaDelAgente(extra: Record<string, unknown> = {}) {
  return {
    question: '¿Cuánto es 2 + 2?',
    questionTypeId: NUMERICA,
    order: 0,
    evidence: 'la suma de dos más dos da cuatro',
    ...extra
  };
}

describe('el esquema del agente: una numérica puede llevar su respuesta', () => {
  /**
   * El campo faltaba, y esa es la raíz del defecto: la única forma de escribir
   * un número era meterlo en `options`. El modelo no estaba siendo descuidado,
   * estaba usando el único campo que había.
   */
  it('acepta la respuesta en settings, de una sola llamada', () => {
    const r = questionSchema.safeParse(preguntaDelAgente({ settings: { correctValue: 4, tolerance: 0 } }));

    expect(r.success).toBe(true);
  });

  it('rechaza una numérica sin respuesta, y dice dónde va', () => {
    const r = questionSchema.safeParse(preguntaDelAgente({ options: [] }));

    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error?.issues)).toContain('settings.correctValue');
  });

  it('rechaza la respuesta metida como opción, que es la forma rota que se midió', () => {
    const r = questionSchema.safeParse(
      preguntaDelAgente({ settings: { correctValue: 4 }, options: [{ label: '4', isCorrect: true }] })
    );

    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error?.issues)).toContain('takes no options');
  });

  it('no acepta un número escrito como texto: el corrector compara números', () => {
    const r = questionSchema.safeParse(preguntaDelAgente({ settings: { correctValue: 'cuatro' } }));

    expect(r.success).toBe(false);
  });

  it('no le cambia nada a los tipos con opciones', () => {
    const r = questionSchema.safeParse({
      question: '¿Cuál es la capital?',
      questionTypeId: OPCION_MULTIPLE,
      order: 0,
      evidence: 'la capital del país es Buenos Aires',
      options: [
        { label: 'Buenos Aires', isCorrect: true },
        { label: 'Córdoba', isCorrect: false }
      ]
    });

    expect(r.success).toBe(true);
  });

  /**
   * Sin evidencia no hay pregunta, y se rechaza en el esquema: así el modelo lo
   * ve como un error de argumentos —que corrige en el mismo paso— y no como una
   * pregunta que el servidor descarta después.
   */
  it('una pregunta sin evidencia no pasa el esquema', () => {
    const { evidence: _sin, ...sinEvidencia } = preguntaDelAgente({ settings: { correctValue: 4 } });

    expect(questionSchema.safeParse(sinEvidencia).success).toBe(false);
  });

  it('ni una evidencia de dos palabras: coincidiría con cualquier lección', () => {
    const r = questionSchema.safeParse(preguntaDelAgente({ settings: { correctValue: 4 }, evidence: 'dos más' }));

    expect(r.success).toBe(false);
  });
});

describe('create_exercise no acepta una cáscara vacía', () => {
  /**
   * El esquema del tool sigue aceptando la lista vacía —el rechazo vive en el
   * `execute`, con un mensaje que le dice al modelo qué hacer en su lugar—, así
   * que lo que se fija acá es que el campo exista y sea una lista.
   */
  it('el tool exige la lista de preguntas', () => {
    const sinPreguntas = createExerciseParam.safeParse({ title: 'Examen final', planKey: 's8.1' });

    expect(sinPreguntas.success).toBe(false);
  });
});

describe('la validación compartida, que cubre la API además del agente', () => {
  const base = { title: 'Evaluación', courseId: 'curso-1' };

  it('al crear, una numérica sin respuesta se rechaza', () => {
    const r = ZExerciseCreate.safeParse({
      ...base,
      questions: [{ question: '¿Cuánto es 2 + 2?', questionTypeId: NUMERICA }]
    });

    expect(r.success).toBe(false);
  });

  it('al crear, con la respuesta en settings pasa', () => {
    const r = ZExerciseCreate.safeParse({
      ...base,
      questions: [{ question: '¿Cuánto es 2 + 2?', questionTypeId: NUMERICA, settings: { correctValue: 4 } }]
    });

    expect(r.success).toBe(true);
  });

  /**
   * En una edición `settings` se MEZCLA con lo guardado, así que un pedido que
   * sólo cambia el enunciado no lo reenvía. Exigirlo ahí rechazaría una edición
   * perfectamente válida — por eso esa regla corre sólo al crear.
   */
  it('al editar sólo el enunciado no se exige reenviar la respuesta', () => {
    const r = ZExerciseUpdate.safeParse({
      questions: [{ id: 1, question: '¿Cuánto es 2 + 2, exactamente?', questionTypeId: NUMERICA }]
    });

    expect(r.success).toBe(true);
  });

  /**
   * El camino que REPARA una numérica rota manda la opción de más con
   * `deletedAt`. Si la regla mirara todas las opciones, bloquearía justo a quien
   * viene a arreglar el problema.
   */
  it('al editar se puede borrar la opción de más de una numérica', () => {
    const r = ZExerciseUpdate.safeParse({
      questions: [
        {
          id: 1,
          question: '¿Cuánto es 2 + 2?',
          questionTypeId: NUMERICA,
          settings: { correctValue: 4 },
          options: [{ id: 9, label: '4', isCorrect: true, deletedAt: '2026-09-16T00:00:00.000Z' }]
        }
      ]
    });

    expect(r.success).toBe(true);
  });

  it('al editar, una opción VIVA en una numérica se sigue rechazando', () => {
    const r = ZExerciseUpdate.safeParse({
      questions: [
        {
          id: 1,
          question: '¿Cuánto es 2 + 2?',
          questionTypeId: NUMERICA,
          options: [{ id: 9, label: '4', isCorrect: true }]
        }
      ]
    });

    expect(r.success).toBe(false);
  });
});
