import { buildStudentSystemPrompt, defaultAiTutorSettings } from '@cio/ai-assistant';
import { describe, expect, it } from 'vitest';

/**
 * El prompt del tutor del estudiante: lo que no se puede perder.
 *
 * Las citas y la fundamentación eran excluyentes (`citationsLine || fundamentar`):
 * con las citas encendidas —el valor por omisión— desaparecía «si no está en el
 * curso, decilo». Medido en producción el 2026-09-13: ante un detalle que la
 * lección no trae, el tutor dio la regla contraria a la lección, entre comillas
 * y con un enlace a una lección inexistente.
 */
const contexto = {
  orgId: 'org',
  courseId: 'curso',
  courseTitle: 'Curso',
  userId: 'estudiante',
  role: 'student',
  locale: 'es'
} as Parameters<typeof buildStudentSystemPrompt>[0];

const conCitas = buildStudentSystemPrompt(contexto, { ...defaultAiTutorSettings, requireCitations: true });
const sinCitas = buildStudentSystemPrompt(contexto, { ...defaultAiTutorSettings, requireCitations: false });

describe('prompt del tutor del estudiante', () => {
  it('encender las citas no borra la instrucción de decir que algo no está en el curso', () => {
    expect(conCitas).toContain('If the answer is not in the course, say so plainly.');
    expect(conCitas).toContain('cite the specific lesson title or exercise title');
  });

  it('sin citas, la fundamentación sigue y la línea de citas no aparece', () => {
    expect(sinCitas).toContain('If the answer is not in the course, say so plainly.');
    expect(sinCitas).not.toContain('cite the specific lesson title or exercise title');
  });

  it('pide decir que el curso no trae un detalle en vez de rellenarlo', () => {
    for (const prompt of [conCitas, sinCitas]) {
      expect(prompt).toContain('say explicitly that the course does not specify that detail');
      expect(prompt).toContain('never contradict what a lesson or exercise says');
    }
  });

  it('no manda a fundamentar todo en la lección abierta', () => {
    expect(conCitas).not.toContain('Use it to ground every answer');
    expect(conCitas).toContain('search the course instead of stretching the open lesson to fit');
  });
});
