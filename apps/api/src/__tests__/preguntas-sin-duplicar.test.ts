import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ContentType } from '@cio/utils/constants';
import { QUESTION_TYPE_IDS } from '@cio/question-types';

/**
 * `write_questions` vuelve a mirar la atadura del plan justo antes de crear.
 *
 * ── Lo que se midió (producción, 2026-09-29) ─────────────────────────────────
 *
 * Nada impide dos rondas a la vez sobre la misma conversación, y esa tarde se
 * solaparon dos veces. `write_questions` miraba la atadura del plan al empezar
 * y creaba el ejercicio al final —a propósito: una cáscara sin preguntas
 * contaría como construida—, después de 9 a 15 segundos de escritor. En esa
 * ventana, otra ronda sobre el mismo ítem crea el suyo, y quedan dos.
 *
 * Curso y lecciones inventados.
 */

vi.mock('isomorphic-dompurify', () => ({
  default: new Proxy({}, { get: () => (valor: unknown) => valor })
}));

vi.mock('@api/utils/tinybird', () => ({
  trackAgentEvent: vi.fn(),
  AgentEvent: new Proxy({}, { get: (_, clave) => String(clave) })
}));

vi.mock('@api/services/course/section', () => ({
  listCourseSections: vi.fn(),
  createCourseSection: vi.fn(),
  updateCourseSectionService: vi.fn(),
  deleteCourseSectionService: vi.fn()
}));

vi.mock('@cio/db/queries/course/content', () => ({
  getCourseContentItems: vi.fn()
}));

vi.mock('@cio/db/queries/lesson/language', async (original) => ({
  ...(await original<typeof import('@cio/db/queries/lesson/language')>()),
  getCourseLessonContents: vi.fn()
}));

vi.mock('@api/services/exercise/exercise', () => ({
  createExercise: vi.fn(),
  getExercise: vi.fn(),
  createExerciseSectionService: vi.fn(),
  updateExerciseService: vi.fn(),
  updateExerciseSectionMetadataService: vi.fn(),
  deleteExerciseForCourseService: vi.fn()
}));

vi.mock('@cio/db/queries/agent', async (original) => ({
  ...(await original<typeof import('@cio/db/queries/agent')>()),
  bindPlanItem: vi.fn(),
  resolvePlanBinding: vi.fn()
}));

vi.mock('@api/services/agent/chat-context', async (original) => ({
  ...(await original<typeof import('@api/services/agent/chat-context')>()),
  verifySectionBelongsToCourse: vi.fn(),
  verifyLessonBelongsToCourse: vi.fn(),
  verifyExerciseBelongsToCourse: vi.fn()
}));

import { resolvePlanBinding } from '@cio/db/queries/agent';
import { getCourseLessonContents } from '@cio/db/queries/lesson/language';
import { listCourseSections } from '@api/services/course/section';
import { getCourseContentItems } from '@cio/db/queries/course/content';
import { createExercise, getExercise, updateExerciseService } from '@api/services/exercise/exercise';
import { buildAgentTools } from '@api/services/agent/chat-tools';
import type { EscritorDePreguntas } from '@api/services/agent/question-writer';

const ID_SECCION = '11111111-1111-4111-8111-111111111111';
const ID_LECCION = 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ID_EJERCICIO_DE_LA_OTRA_RONDA = 'eeeeeee1-eeee-4eee-8eee-eeeeeeeeeeee';

const TEXTO_DE_LA_LECCION =
  '<p>La mesa de ayuda atiende de 8 a 18. El reclamo se cierra con la conformidad del cliente.</p>';

const PREGUNTA = {
  question: '¿Con qué se cierra un reclamo?',
  questionTypeId: QUESTION_TYPE_IDS.RADIO,
  points: 1,
  order: 0,
  evidence: 'El reclamo se cierra con la conformidad del cliente',
  options: [
    { label: 'Con la conformidad del cliente', isCorrect: true },
    { label: 'Con la firma del operador', isCorrect: false }
  ]
};

const ARGS = {
  title: 'Autoevaluación de la mesa de ayuda',
  lessonId: 'S1.L1',
  lessons: ['S1.L1'],
  planKey: 's1.e1',
  brief: 'Tres preguntas sobre cómo se cierra un reclamo.'
};

type Herramienta = { execute: (args: unknown, opciones: unknown) => Promise<Record<string, unknown>> };

function herramientas() {
  const escribirPreguntas: EscritorDePreguntas = vi.fn().mockResolvedValue({ preguntas: [PREGUNTA] });

  return buildAgentTools('org', 'usuario', 'curso', [], {
    conversationId: 'conversacion',
    isBuilding: true,
    locale: 'es',
    escribirPreguntas
  }) as Record<string, Herramienta>;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.mocked(listCourseSections).mockResolvedValue([
    { id: ID_SECCION, title: 'Atención', order: 0, createdAt: '2026-01-01T00:00:00Z' }
  ] as never);
  vi.mocked(getCourseContentItems).mockResolvedValue([
    {
      id: ID_LECCION,
      type: ContentType.Lesson,
      title: 'La mesa de ayuda',
      sectionId: ID_SECCION,
      order: 0,
      hasNoteContent: true,
      questionCount: null
    }
  ] as never);
  vi.mocked(getCourseLessonContents).mockResolvedValue([
    { id: ID_LECCION, title: 'La mesa de ayuda', content: TEXTO_DE_LA_LECCION }
  ] as never);
  vi.mocked(createExercise).mockResolvedValue({ id: 'ejercicio-nuevo', title: ARGS.title } as never);
  vi.mocked(updateExerciseService).mockResolvedValue(undefined as never);
});

describe('la atadura se vuelve a mirar justo antes de crear', () => {
  it('si otra ronda creó el ejercicio mientras se escribían las preguntas, no se crea otro', async () => {
    // Al empezar no había nada; al terminar el escritor, ya estaba el de la otra ronda.
    vi.mocked(resolvePlanBinding)
      .mockResolvedValueOnce(null)
      .mockResolvedValue({ entityId: ID_EJERCICIO_DE_LA_OTRA_RONDA } as never);
    vi.mocked(getExercise).mockResolvedValue({
      id: ID_EJERCICIO_DE_LA_OTRA_RONDA,
      title: ARGS.title,
      questions: [{ id: 1 }, { id: 2 }, { id: 3 }]
    } as never);

    const resultado = await herramientas().write_questions.execute(ARGS, { toolCallId: 'llamada', messages: [] });

    expect(createExercise).not.toHaveBeenCalled();
    expect(updateExerciseService).not.toHaveBeenCalled();
    expect(resultado).toMatchObject({
      exerciseId: ID_EJERCICIO_DE_LA_OTRA_RONDA,
      added: 0,
      questionCount: 3,
      reused: true
    });
  });

  it('si el de la otra ronda quedó vacío, las preguntas van a ése', async () => {
    vi.mocked(resolvePlanBinding)
      .mockResolvedValueOnce(null)
      .mockResolvedValue({ entityId: ID_EJERCICIO_DE_LA_OTRA_RONDA } as never);
    vi.mocked(getExercise).mockResolvedValue({
      id: ID_EJERCICIO_DE_LA_OTRA_RONDA,
      title: ARGS.title,
      questions: []
    } as never);

    const resultado = await herramientas().write_questions.execute(ARGS, { toolCallId: 'llamada', messages: [] });

    expect(createExercise).not.toHaveBeenCalled();
    expect(updateExerciseService).toHaveBeenCalledWith(
      ID_EJERCICIO_DE_LA_OTRA_RONDA,
      expect.objectContaining({ questions: [expect.objectContaining({ question: PREGUNTA.question })] })
    );
    expect(resultado).toMatchObject({ exerciseId: ID_EJERCICIO_DE_LA_OTRA_RONDA, added: 1 });
  });

  it('sin nadie en el medio, se crea como siempre', async () => {
    vi.mocked(resolvePlanBinding).mockResolvedValue(null);

    const resultado = await herramientas().write_questions.execute(ARGS, { toolCallId: 'llamada', messages: [] });

    expect(createExercise).toHaveBeenCalledTimes(1);
    expect(resultado).toMatchObject({ exerciseId: 'ejercicio-nuevo', added: 1, created: true });
  });
});
