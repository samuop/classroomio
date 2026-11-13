import { describe, expect, it } from 'vitest';

// Desde el código fuente y no desde `@cio/ai-assistant`: los tests de la API
// leen el `dist`, y un prompt recién cambiado no llega ahí hasta compilar.
import { buildTeacherSystemPrompt } from '../../../../packages/ai-assistant/src/prompt/teacher';

/**
 * Cuando la docente pide verificar algo, manda la fuente y no la lección.
 *
 * Medido el 2026-11-12 con un pedido real («¿podés verificar esto?» y cinco
 * frases de un curso que contradecían el documento): el asistente las dio por
 * correctas porque así lo decía una lección —que había escrito él—, y sin
 * recorte de contexto contestaba «verdadero en el curso, con matiz en el
 * documento». Diez de 25 frases en cinco corridas. Con esta sección del
 * prompt, 0 de 25.
 *
 * Vale en todos los modos: la pregunta llega con un plan a medias, construyendo
 * o editando un curso terminado.
 */

const CONTEXTO = { orgId: 'o', courseId: 'c', courseTitle: 'C', userId: 'u', role: 'teacher' as never, locale: 'es' };

describe.each(['plan', 'build', 'full'] as const)('el asistente en modo %s, cuando le piden verificar', (mode) => {
  const prompt = buildTeacherSystemPrompt(CONTEXTO, { mode: mode as never });

  it('mide contra los documentos del curso, y la lección no es prueba', () => {
    expect(prompt).toContain('## When the teacher asks whether something is right');
    expect(prompt).toMatch(/the measure is what the course's SOURCE DOCUMENTS say/);
    expect(prompt).toMatch(/What a lesson or a question of this course says is NOT evidence/);
  });

  it('da un solo veredicto, el de la fuente, y nunca «verdadero en el curso»', () => {
    expect(prompt).toMatch(/Give ONE verdict per statement, and it is the source's/);
    expect(prompt).toMatch(/never give a split verdict such as "true in the course"/);
    expect(prompt).toMatch(/that is an error in the lesson: say so, name the lesson, and offer to fix it/);
  });

  it('cita sólo lo que leyó, y no ofrece convertir la frase en regla', () => {
    expect(prompt).toMatch(/Quote only words you have just read in a tool result/);
    expect(prompt).toMatch(/Do not offer to save a statement as a rule or a correction/);
  });
});
