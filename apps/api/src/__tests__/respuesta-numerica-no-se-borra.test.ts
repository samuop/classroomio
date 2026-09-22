import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Agregar preguntas a un examen no puede borrar la respuesta de las que ya tiene.
 *
 * ── Lo que pasó (producción, 2026-09-16) ─────────────────────────────────────
 *
 * El agente armó un examen final en varias tandas de `add_questions`. Cada
 * tanda reenviaba las preguntas viejas SIN `settings`, y el servicio tomaba
 * «sin settings» como «vaciar settings», que en una NUMERIC es donde vive la
 * respuesta (`settings.correctValue`). Cada tanda borró la respuesta de las
 * numéricas de la anterior, y una pregunta sin respuesta se califica como el
 * corrector pueda.
 *
 * Dos arreglos, cada uno con su test:
 *   - el servicio: `settings` ausente es «sin cambios», como todos los demás
 *     campos (`points`, `order`, `questionTypeId`, …);
 *   - `add_questions` manda sólo las preguntas nuevas.
 */

vi.mock('isomorphic-dompurify', () => ({
  default: new Proxy({}, { get: () => (valor: unknown) => valor })
}));

vi.mock('@api/utils/tinybird', () => ({
  trackAgentEvent: vi.fn(),
  AgentEvent: new Proxy({}, { get: (_, clave) => String(clave) })
}));

vi.mock('@api/services/exercise/exercise', () => ({
  createExercise: vi.fn(),
  getExercise: vi.fn(),
  createExerciseSectionService: vi.fn(),
  updateExerciseService: vi.fn(),
  updateExerciseSectionMetadataService: vi.fn(),
  deleteExerciseForCourseService: vi.fn()
}));

vi.mock('@api/services/agent/chat-context', async (original) => ({
  ...(await original<typeof import('@api/services/agent/chat-context')>()),
  verifyExerciseBelongsToCourse: vi.fn()
}));

import { computeExerciseDiff } from '@api/services/exercise/utils';
import { getExercise, updateExerciseService } from '@api/services/exercise/exercise';
import { buildAgentTools } from '@api/services/agent/chat-tools';

const NUMERICA = 6;
const OPCION_UNICA = 1;

function numericaGuardada() {
  return {
    id: 101,
    title: '¿Cuánto suma el arqueo?',
    questionTypeId: NUMERICA,
    points: 1,
    order: 0,
    exerciseSectionId: null,
    settings: { correctValue: 1250 },
    options: []
  };
}

function opcionUnicaGuardada() {
  return {
    id: 102,
    title: '¿Quién hace los retiros?',
    questionTypeId: OPCION_UNICA,
    points: 1,
    order: 1,
    exerciseSectionId: null,
    settings: {},
    options: [
      { id: 10, questionId: 102, label: 'El encargado de caja', isCorrect: true, settings: { feedback: 'Sí' } },
      { id: 11, questionId: 102, label: 'Cualquier cajero', isCorrect: false, settings: {} }
    ]
  };
}

describe('el servicio: una pregunta reenviada sin settings conserva los suyos', () => {
  it('una numérica reenviada sin settings no pierde su respuesta', () => {
    const diff = computeExerciseDiff([numericaGuardada()] as never, [
      { id: 101, question: '¿Cuánto suma el arqueo?', questionTypeId: NUMERICA, points: 1, order: 0, options: [] }
    ]);

    expect(diff.questions.updates).toEqual([]);
  });

  it('si además cambia el enunciado, se actualiza el enunciado y nada más', () => {
    const diff = computeExerciseDiff([numericaGuardada()] as never, [
      { id: 101, question: '¿Cuánto da el arqueo del turno?', questionTypeId: NUMERICA, options: [] }
    ]);

    expect(diff.questions.updates).toEqual([{ id: 101, data: { title: '¿Cuánto da el arqueo del turno?' } }]);
  });

  it('mandar settings vacíos a propósito sí los vacía', () => {
    const diff = computeExerciseDiff([numericaGuardada()] as never, [
      { id: 101, question: '¿Cuánto suma el arqueo?', questionTypeId: NUMERICA, settings: {}, options: [] }
    ]);

    expect(diff.questions.updates).toEqual([{ id: 101, data: { settings: {} } }]);
  });

  it('mandar otra respuesta la cambia', () => {
    const diff = computeExerciseDiff([numericaGuardada()] as never, [
      { id: 101, question: '¿Cuánto suma el arqueo?', settings: { correctValue: 1200 }, options: [] }
    ]);

    expect(diff.questions.updates).toEqual([{ id: 101, data: { settings: { correctValue: 1200 } } }]);
  });

  it('una opción reenviada sin settings conserva los suyos', () => {
    const diff = computeExerciseDiff([opcionUnicaGuardada()] as never, [
      {
        id: 102,
        question: '¿Quién hace los retiros?',
        options: [
          { id: 10, label: 'El encargado de caja', isCorrect: true },
          { id: 11, label: 'Cualquier cajero', isCorrect: false }
        ]
      }
    ]);

    expect(diff.options.updates).toEqual([]);
    expect(diff.options.deletedIds).toEqual([]);
  });
});

describe('add_questions: agrega sin reescribir lo que ya estaba', () => {
  const OPCIONES = { toolCallId: 'llamada', messages: [] };

  function herramientas() {
    return buildAgentTools('org', 'usuario', 'curso', [], {
      conversationId: 'conversacion',
      isBuilding: true,
      locale: 'es'
    }) as Record<string, { execute: (args: unknown, opciones: unknown) => Promise<Record<string, unknown>> }>;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    // Un examen final: sin lección ni sección de lecciones, así que no hay nada que leer antes.
    vi.mocked(getExercise).mockResolvedValue({
      id: 'examen',
      title: 'Examen final',
      lessonId: null,
      sectionId: null,
      questions: [numericaGuardada(), opcionUnicaGuardada()]
    } as never);
  });

  it('manda al servicio sólo las preguntas nuevas', async () => {
    const resultado = await herramientas().add_questions.execute(
      {
        exerciseId: 'examen',
        questions: [
          {
            question: '¿Cada cuánto se hace un retiro?',
            questionTypeId: NUMERICA,
            points: 1,
            options: [],
            settings: { correctValue: 5000 }
          }
        ]
      },
      OPCIONES
    );

    expect(resultado).toMatchObject({ addedCount: 1, totalCount: 3 });
    expect(updateExerciseService).toHaveBeenCalledTimes(1);

    const enviadas = vi.mocked(updateExerciseService).mock.calls[0][1].questions ?? [];

    expect(enviadas).toHaveLength(1);
    expect(enviadas[0]).toMatchObject({
      question: '¿Cada cuánto se hace un retiro?',
      order: 2,
      settings: { correctValue: 5000 }
    });
    expect(enviadas.some((pregunta) => pregunta.id !== undefined)).toBe(false);
  });
});
