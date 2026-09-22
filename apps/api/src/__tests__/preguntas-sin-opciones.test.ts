import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ContentType } from '@cio/utils/constants';

/**
 * Una pregunta de opción sin opciones no se guarda.
 *
 * ── Qué se midió ─────────────────────────────────────────────────────────────
 *
 * Producción, 2026-09-22: la práctica de una sección se creó con cinco
 * preguntas —dos RADIO, una CHECKBOX, una TRUE_FALSE y otra RADIO— SIN NINGUNA
 * opción. El log decía «6 pregunta(s) de 6 pedidas» y el resultado `added: 6`.
 * Nadie se enteró: `options` tiene `.default([])`, así que omitirlo es válido, y
 * la única regla de tipo que había miraba NUMERIC.
 *
 * Una pregunta de opción sin opciones es una pregunta que el alumno no puede
 * contestar, y además es invisible para el resto del sistema: el barrido de
 * datos viejos busca en las etiquetas de las opciones, y el dato viejo estaba
 * justo en la opción que no existía.
 *
 * Lo que se fija:
 *   1. la regla de cada tipo en el esquema de CREACIÓN;
 *   2. que la actualización parcial NO la herede (`{ id, question }` sigue
 *      valiendo, porque ahí las opciones que no viajan son las que ya están);
 *   3. que `write_questions` rebote UNA vez al escritor con las que faltan, y
 *      sume las que vuelven bien.
 *
 * Curso inventado, de una distribuidora que no existe.
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

vi.mock('@cio/db/queries/lesson/language', () => ({
  getCourseLessonContents: vi.fn()
}));

vi.mock('@api/services/lesson/lesson', () => ({
  createLesson: vi.fn(),
  getLesson: vi.fn(),
  updateLessonService: vi.fn(),
  deleteLessonService: vi.fn()
}));

vi.mock('@api/services/exercise/exercise', () => ({
  createExercise: vi.fn(),
  getExercise: vi.fn(),
  createExerciseSectionService: vi.fn(),
  updateExerciseService: vi.fn(),
  updateExerciseSectionMetadataService: vi.fn(),
  deleteExerciseForCourseService: vi.fn()
}));

vi.mock('@cio/db/queries/exercise', async (original) => ({
  ...(await original<typeof import('@cio/db/queries/exercise')>()),
  getExerciseSectionsByExerciseId: vi.fn().mockResolvedValue([])
}));

vi.mock('@cio/db/queries/agent', async (original) => ({
  ...(await original<typeof import('@cio/db/queries/agent')>()),
  bindPlanItem: vi.fn(),
  resolvePlanBinding: vi.fn().mockResolvedValue(null)
}));

vi.mock('@api/services/agent/chat-context', async (original) => ({
  ...(await original<typeof import('@api/services/agent/chat-context')>()),
  verifySectionBelongsToCourse: vi.fn(),
  verifyLessonBelongsToCourse: vi.fn(),
  verifyExerciseBelongsToCourse: vi.fn()
}));

import { listCourseSections } from '@api/services/course/section';
import { getCourseContentItems } from '@cio/db/queries/course/content';
import { getCourseLessonContents } from '@cio/db/queries/lesson/language';
import { createExercise } from '@api/services/exercise/exercise';
import { buildAgentTools } from '@api/services/agent/chat-tools';
import { questionSchema, updateQuestionPatchSchema } from '@api/services/agent/agent-tool-schemas';

const LECCION_TEXTO =
  'El remito se revisa contra el pedido antes de firmarlo. Si falta mercadería, se anota la diferencia en el remito y se avisa a Mesa de Ayuda el mismo día.';

const EVIDENCIA = 'El remito se revisa contra el pedido';
const OTRA_EVIDENCIA = 'se anota la diferencia en el remito';

/** RADIO = 1, CHECKBOX = 2, TRUE_FALSE = 4. */
const base = {
  question: '¿Contra qué se revisa el remito?',
  points: 1,
  order: 0,
  evidence: EVIDENCIA
};

describe('la regla de cada tipo de pregunta, al crearla', () => {
  it('una RADIO sin opciones se rechaza, y el motivo dice con cuántas vino', () => {
    const revisada = questionSchema.safeParse({ ...base, questionTypeId: 1, options: [] });

    expect(revisada.success).toBe(false);
    const motivo = revisada.success ? '' : revisada.error.issues.map((i) => i.message).join(' ');
    expect(motivo).toContain('RADIO');
    expect(motivo).toContain('0 option(s)');
  });

  it('una RADIO con dos correctas se rechaza', () => {
    const revisada = questionSchema.safeParse({
      ...base,
      questionTypeId: 1,
      options: [
        { label: 'Contra el pedido', isCorrect: true },
        { label: 'Contra la factura', isCorrect: true }
      ]
    });

    expect(revisada.success).toBe(false);
  });

  it('una RADIO con dos opciones y una correcta pasa', () => {
    const revisada = questionSchema.safeParse({
      ...base,
      questionTypeId: 1,
      options: [
        { label: 'Contra el pedido', isCorrect: true },
        { label: 'Contra la factura', isCorrect: false }
      ]
    });

    expect(revisada.success).toBe(true);
  });

  it('una CHECKBOX acepta más de una correcta, pero no cero', () => {
    const conDos = questionSchema.safeParse({
      ...base,
      questionTypeId: 2,
      options: [
        { label: 'Se anota la diferencia', isCorrect: true },
        { label: 'Se avisa el mismo día', isCorrect: true }
      ]
    });
    const sinNinguna = questionSchema.safeParse({
      ...base,
      questionTypeId: 2,
      options: [
        { label: 'Se anota la diferencia', isCorrect: false },
        { label: 'Se avisa el mismo día', isCorrect: false }
      ]
    });

    expect(conDos.success).toBe(true);
    expect(sinNinguna.success).toBe(false);
  });

  it('una TRUE_FALSE quiere exactamente dos opciones', () => {
    const dos = questionSchema.safeParse({
      ...base,
      questionTypeId: 4,
      options: [
        { label: 'Verdadero', isCorrect: true },
        { label: 'Falso', isCorrect: false }
      ]
    });
    const tres = questionSchema.safeParse({
      ...base,
      questionTypeId: 4,
      options: [
        { label: 'Verdadero', isCorrect: true },
        { label: 'Falso', isCorrect: false },
        { label: 'No sé', isCorrect: false }
      ]
    });

    expect(dos.success).toBe(true);
    expect(tres.success).toBe(false);
  });

  /** Una numérica sigue sin llevar opciones: la regla vieja no se pisó. */
  it('una NUMERIC sin opciones sigue siendo válida si trae su respuesta', () => {
    const revisada = questionSchema.safeParse({
      ...base,
      questionTypeId: 6,
      options: [],
      settings: { correctValue: 1 }
    });

    expect(revisada.success).toBe(true);
  });

  /**
   * La actualización parcial NO hereda la regla: acá las opciones que no viajan
   * son las que la pregunta YA tiene guardadas, y exigirlas rompería el camino
   * normal de corregir un enunciado.
   */
  it('update_questions sigue aceptando { id, question } sola', () => {
    expect(updateQuestionPatchSchema.safeParse({ id: 12, question: '¿Contra qué se revisa el remito?' }).success).toBe(
      true
    );
  });
});

const ID = {
  seccion: '11111111-1111-4111-8111-111111111111',
  leccion: 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  ejercicio: 'bbbbbbb1-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
};

const SECCIONES = [{ id: ID.seccion, title: 'Recepción de pedidos', order: 0 }];
const ITEMS = [
  {
    id: ID.leccion,
    type: ContentType.Lesson,
    title: 'Qué se recibe y qué no',
    sectionId: ID.seccion,
    order: 0,
    hasNoteContent: true,
    questionCount: null
  }
];
const CONTENIDOS = [{ id: ID.leccion, title: 'Qué se recibe y qué no', content: `<p>${LECCION_TEXTO}</p>` }];

const OPCIONES = { toolCallId: 'llamada', messages: [] };

type Herramienta = { execute: (args: unknown, opciones: unknown) => Promise<Record<string, unknown>> };

const escribirPreguntas = vi.fn();

function herramientas() {
  return buildAgentTools('org', 'usuario', 'curso', [], {
    conversationId: 'conversacion',
    isBuilding: true,
    locale: 'es',
    escribirPreguntas
  }) as Record<string, Herramienta>;
}

function conOpciones(question: string, evidence = EVIDENCIA) {
  return {
    question,
    questionTypeId: 1,
    points: 1,
    order: 0,
    evidence,
    options: [
      { label: 'Contra el pedido', isCorrect: true },
      { label: 'Contra la factura', isCorrect: false }
    ]
  };
}

function sinOpciones(question: string, evidence = EVIDENCIA) {
  return { question, questionTypeId: 1, points: 1, order: 0, evidence, options: [] };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listCourseSections).mockResolvedValue(SECCIONES as never);
  vi.mocked(getCourseContentItems).mockResolvedValue(ITEMS as never);
  vi.mocked(getCourseLessonContents).mockResolvedValue(CONTENIDOS as never);
  vi.mocked(createExercise).mockResolvedValue({ id: ID.ejercicio, title: 'Autoevaluación' } as never);
});

describe('write_questions rebota cuando el escritor se olvidó las opciones', () => {
  const pedido = { sectionId: 'S1', title: 'Autoevaluación de recepción', order: 1, lessons: ['S1.L1'] };

  it('le vuelve a pedir las que faltan, UNA vez, y suma las que vuelven bien', async () => {
    escribirPreguntas
      .mockResolvedValueOnce({
        preguntas: [conOpciones('¿Contra qué se revisa el remito?'), sinOpciones('¿Qué se hace si falta mercadería?', OTRA_EVIDENCIA)]
      })
      .mockResolvedValueOnce({
        preguntas: [conOpciones('¿Qué se hace si falta mercadería?', OTRA_EVIDENCIA)]
      });

    const resultado = await herramientas().write_questions.execute(pedido, OPCIONES);

    expect(escribirPreguntas).toHaveBeenCalledTimes(2);

    // El rebote nombra la que faltó y dice la regla del tipo.
    const segunda = escribirPreguntas.mock.calls[1][0];
    expect(segunda.brief).toContain('¿Qué se hace si falta mercadería?');
    expect(segunda.brief).toContain('without options');
    expect(segunda.brief).toContain('RADIO');

    expect(resultado).toMatchObject({ added: 2 });
    expect(resultado.rejected).toBeUndefined();

    const creado = vi.mocked(createExercise).mock.calls[0][0];
    expect(creado.questions).toHaveLength(2);
    expect(creado.questions?.every((pregunta) => (pregunta.options?.length ?? 0) === 2)).toBe(true);
  });

  it('si tras el rebote siguen sin opciones, van en rejected y no se guardan', async () => {
    escribirPreguntas.mockResolvedValue({
      preguntas: [conOpciones('¿Contra qué se revisa el remito?'), sinOpciones('¿Qué se hace si falta mercadería?', OTRA_EVIDENCIA)]
    });

    const resultado = await herramientas().write_questions.execute(pedido, OPCIONES);

    expect(escribirPreguntas).toHaveBeenCalledTimes(2);
    expect(resultado).toMatchObject({ added: 1 });
    expect(resultado.rejected).toMatchObject([{ question: '¿Qué se hace si falta mercadería?' }]);
    expect(String((resultado.rejected as Array<{ reason: string }>)[0].reason)).toContain('RADIO');

    const creado = vi.mocked(createExercise).mock.calls[0][0];
    expect(creado.questions).toHaveLength(1);
  });

  it('sin preguntas sin opciones no hay rebote', async () => {
    escribirPreguntas.mockResolvedValue({ preguntas: [conOpciones('¿Contra qué se revisa el remito?')] });

    const resultado = await herramientas().write_questions.execute(pedido, OPCIONES);

    expect(escribirPreguntas).toHaveBeenCalledTimes(1);
    expect(resultado).toMatchObject({ added: 1 });
  });
});
