import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { camposDelEscritor } from '@api/services/agent/question-writer';

/**
 * Lo que el proveedor VE del esquema del escritor de preguntas.
 *
 * Medido el 2026-09-22 contra el modelo real de producción, mismo prompt y
 * mismas lecciones: con `options` opcional (el `.default([])` de
 * `questionFields`), 7 de 12 preguntas de opción volvieron sin ninguna opción;
 * con `options` requerido, 0 de 12. El esquema JSON es la única instrucción que
 * ese proveedor cumple siempre, así que lo que tiene que ser obligatorio se
 * declara ahí y no sólo en el prompt.
 */
describe('el esquema del escritor de preguntas, como lo ve el proveedor', () => {
  const esquema = z.toJSONSchema(z.object({ questions: z.array(camposDelEscritor) }), { io: 'input' }) as {
    properties: { questions: { items: { required?: string[]; properties: Record<string, { default?: unknown }> } } };
  };
  const pregunta = esquema.properties.questions.items;

  it('exige las opciones en cada pregunta', () => {
    expect(pregunta.required).toContain('options');
    expect(pregunta.properties.options.default).toBeUndefined();
  });

  it('y sigue exigiendo lo de siempre: enunciado, tipo, orden y evidencia', () => {
    expect(pregunta.required).toEqual(expect.arrayContaining(['question', 'questionTypeId', 'order', 'evidence']));
  });

  it('una numérica cumple con un arreglo vacío', () => {
    const numerica = camposDelEscritor.safeParse({
      question: '¿Cuántos días corridos hay para reabrir un ticket?',
      questionTypeId: 6,
      order: 0,
      evidence: 'Podés reabrir el ticket dentro de los 10 días corridos posteriores a su cierre.',
      options: [],
      numericAnswer: 10
    });

    expect(numerica.success).toBe(true);
  });

  it('sin el campo, la pregunta no pasa el esquema del escritor', () => {
    const sinOpciones = camposDelEscritor.safeParse({
      question: '¿Cuál es el canal principal?',
      questionTypeId: 1,
      order: 0,
      evidence: 'El portal de autogestión es el canal principal y obligatorio.'
    });

    expect(sinOpciones.success).toBe(false);
  });
});
