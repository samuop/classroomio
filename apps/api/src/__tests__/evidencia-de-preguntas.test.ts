import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ContentType } from '@cio/utils/constants';

/**
 * Las preguntas salen de lo que la lección DICE, y eso se verifica.
 *
 * ── Qué reemplaza ────────────────────────────────────────────────────────────
 *
 * El control anterior era «leíste estas lecciones en esta ronda»: miraba el
 * proceso, no el resultado. Medido el 2026-09-21 en una autoevaluación de
 * producción, 4 de 8 preguntas no salían de la lección que evaluaban, con la
 * lectura hecha y el control en verde.
 *
 * Ahora cada pregunta trae la frase de la lección que evalúa y el servidor la
 * busca. Lo que se fija acá:
 *
 *   1. que la búsqueda sea tolerante donde tiene que serlo (tildes, comillas,
 *      mayúsculas, «…») y NO donde no (una frase que no está, no está);
 *   2. que una evidencia inexistente no cree NADA en `create_exercise`, y que
 *      el rechazo diga cuál es la pregunta;
 *   3. que la evidencia quede guardada con la pregunta, que es lo que permite
 *      revisar después de qué frase salió cada una;
 *   4. que `write_questions` descarte las preguntas que no verifican y cree las
 *      que sí, y que con cero válidas no cree ningún ejercicio.
 *
 * Curso inventado, de una distribuidora que no existe.
 */

// El entorno de tests de la API es `node` y no puede cargar jsdom. Ningún
// camino de acá sanea HTML de verdad.
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
import { createExercise, createExerciseSectionService, getExercise, updateExerciseService } from '@api/services/exercise/exercise';
import { buildAgentTools } from '@api/services/agent/chat-tools';
import {
  avisoDeEvidencia,
  evidenciaAparece,
  verificarEvidencias
} from '@api/services/agent/evidencia-de-preguntas';
import { cuantasPreguntas } from '@api/services/agent/question-writer';

const LECCION_TEXTO =
  'El remito se revisa contra el pedido antes de firmarlo. Si falta mercadería, se anota la diferencia en el remito y se avisa a Mesa de Ayuda el mismo día.';

describe('¿la evidencia está en la lección?', () => {
  it('ignora tildes, mayúsculas y comillas: lo que se comprueba es que la frase exista', () => {
    expect(evidenciaAparece('Se avisa a MESA DE AYUDA el mismo día', [LECCION_TEXTO])).toBe(true);
    expect(evidenciaAparece('se anota la diferencia en el remito', [LECCION_TEXTO])).toBe(true);
    expect(evidenciaAparece('«El remito se revisa contra el pedido»', [LECCION_TEXTO])).toBe(true);
  });

  it('una evidencia cortada con puntos suspensivos se busca por su tramo más largo', () => {
    expect(evidenciaAparece('Si falta mercadería … el mismo día', [LECCION_TEXTO])).toBe(true);
  });

  it('una frase que la lección no dice no aparece, por verosímil que suene', () => {
    expect(evidenciaAparece('se avisa a Mesa de Ayuda dentro de las 48 horas', [LECCION_TEXTO])).toBe(false);
  });

  it('un fragmento demasiado corto no alcanza: coincidiría con cualquier lección', () => {
    expect(evidenciaAparece('el remito', [LECCION_TEXTO])).toBe(false);
  });

  it('busca en todas las lecciones que el ejercicio cubre, no sólo en la primera', () => {
    expect(evidenciaAparece('se anota la diferencia en el remito', ['Otra cosa.', LECCION_TEXTO])).toBe(true);
  });
});

describe('separar las que verifican de las que no', () => {
  const preguntas = [
    { question: '¿Contra qué se revisa el remito?', evidence: 'El remito se revisa contra el pedido' },
    { question: '¿En cuántas horas se avisa?', evidence: 'se avisa dentro de las 48 horas' },
    { question: '¿Y si falta mercadería?', evidence: '' }
  ];

  it('deja pasar la que está y rechaza la que no, con su posición', () => {
    const { validas, rechazadas } = verificarEvidencias(preguntas, [LECCION_TEXTO]);

    expect(validas.map((p) => p.question)).toEqual(['¿Contra qué se revisa el remito?']);
    expect(rechazadas.map((r) => r.indice)).toEqual([1, 2]);
  });

  it('el rechazo nombra la pregunta y su evidencia, y dice cómo se corrige', () => {
    const { rechazadas } = verificarEvidencias(preguntas, [LECCION_TEXTO]);
    const aviso = avisoDeEvidencia(rechazadas, [{ id: 'l1', title: 'Recepción de mercadería' }]);

    expect(aviso).toMatch(/^Nothing was created\./);
    expect(aviso).toContain('¿En cuántas horas se avisa?');
    expect(aviso).toContain('se avisa dentro de las 48 horas');
    expect(aviso).toContain('Recepción de mercadería');
    expect(aviso).toMatch(/read_lessons/);
  });
});

describe('cuántas preguntas pedirle al escritor', () => {
  it('nunca menos de 6 ni más de 10, y sale del texto que hay', () => {
    expect(cuantasPreguntas(500)).toBe(6);
    expect(cuantasPreguntas(14_000)).toBe(8);
    expect(cuantasPreguntas(100_000)).toBe(10);
  });
});

const ID = {
  seccion: '11111111-1111-4111-8111-111111111111',
  leccion: 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  ejercicio: 'bbbbbbb1-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  bloque: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
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

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listCourseSections).mockResolvedValue(SECCIONES as never);
  vi.mocked(getCourseContentItems).mockResolvedValue(ITEMS as never);
  vi.mocked(getCourseLessonContents).mockResolvedValue(CONTENIDOS as never);
  vi.mocked(createExercise).mockResolvedValue({ id: ID.ejercicio, title: 'Autoevaluación' } as never);
  vi.mocked(createExerciseSectionService).mockResolvedValue({ id: ID.bloque, title: 'Bloque' } as never);
});

describe('create_exercise: el docente dicta, el servidor verifica', () => {
  it('con una evidencia que no está en la lección no crea NADA', async () => {
    const resultado = await herramientas().create_exercise.execute(
      {
        sectionId: 'S1',
        title: 'Autoevaluación de recepción',
        order: 1,
        questions: [
          {
            question: '¿En cuántas horas se avisa?',
            questionTypeId: 1,
            order: 0,
            options: [
              { label: '48 horas', isCorrect: true },
              { label: 'El mismo día', isCorrect: false }
            ],
            evidence: 'se avisa dentro de las 48 horas'
          }
        ]
      },
      OPCIONES
    );

    expect(createExercise).not.toHaveBeenCalled();
    expect(resultado.ok).toBe(false);
    expect(String(resultado.error)).toContain('¿En cuántas horas se avisa?');
  });

  it('con la evidencia bien copiada crea el ejercicio y la guarda con la pregunta', async () => {
    const resultado = await herramientas().create_exercise.execute(
      {
        sectionId: 'S1',
        title: 'Autoevaluación de recepción',
        order: 1,
        questions: [
          {
            question: '¿Contra qué se revisa el remito?',
            questionTypeId: 1,
            order: 0,
            options: [
              { label: 'Contra el pedido', isCorrect: true },
              { label: 'Contra la factura', isCorrect: false }
            ],
            evidence: 'El remito se revisa contra el pedido'
          }
        ]
      },
      OPCIONES
    );

    expect(resultado).toMatchObject({ id: ID.ejercicio, questionCount: 1 });

    const creado = vi.mocked(createExercise).mock.calls[0][0];

    expect(creado.questions?.[0].settings).toMatchObject({ evidence: 'El remito se revisa contra el pedido' });
  });
});

describe('write_questions: las escribe quien leyó las lecciones', () => {
  function pregunta(evidence: string, question = '¿Contra qué se revisa el remito?') {
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

  it('le pasa al escritor el TEXTO de las lecciones, no sus ids', async () => {
    escribirPreguntas.mockResolvedValue({ preguntas: [pregunta('El remito se revisa contra el pedido')] });

    await herramientas().write_questions.execute(
      { sectionId: 'S1', title: 'Autoevaluación de recepción', order: 1, lessons: ['S1.L1'] },
      OPCIONES
    );

    expect(escribirPreguntas).toHaveBeenCalledWith(
      expect.objectContaining({
        locale: 'es',
        lecciones: [{ title: 'Qué se recibe y qué no', text: LECCION_TEXTO }]
      })
    );
  });

  it('crea las que verifican y descarta las que no, diciendo cuáles', async () => {
    escribirPreguntas.mockResolvedValue({
      preguntas: [
        pregunta('El remito se revisa contra el pedido'),
        pregunta('se avisa dentro de las 48 horas', '¿En cuántas horas se avisa?')
      ],
      nota: 'La lección no habla de devoluciones.'
    });

    const resultado = await herramientas().write_questions.execute(
      { sectionId: 'S1', title: 'Autoevaluación de recepción', order: 1, lessons: ['S1.L1'] },
      OPCIONES
    );

    expect(resultado).toMatchObject({
      exerciseId: ID.ejercicio,
      added: 1,
      writerNote: 'La lección no habla de devoluciones.'
    });
    expect(resultado.rejected).toMatchObject([{ question: '¿En cuántas horas se avisa?' }]);

    const creado = vi.mocked(createExercise).mock.calls[0][0];

    expect(creado.questions).toHaveLength(1);
    expect(creado.questions?.[0].settings).toMatchObject({ evidence: 'El remito se revisa contra el pedido' });
  });

  /**
   * Es el caso que más importa: sin esto, un escritor que inventó las diez
   * preguntas dejaría un ejercicio vacío que cuenta como construido y que
   * ningún control reclama como faltante.
   */
  it('con CERO preguntas válidas no crea ningún ejercicio', async () => {
    escribirPreguntas.mockResolvedValue({
      preguntas: [pregunta('se avisa dentro de las 48 horas', '¿En cuántas horas se avisa?')]
    });

    const resultado = await herramientas().write_questions.execute(
      { sectionId: 'S1', title: 'Autoevaluación de recepción', order: 1, lessons: ['S1.L1'] },
      OPCIONES
    );

    expect(createExercise).not.toHaveBeenCalled();
    expect(updateExerciseService).not.toHaveBeenCalled();
    expect(resultado).toMatchObject({ added: 0 });
    expect(String(resultado.note)).toContain('Nothing was created');
  });

  it('con blockTitle crea el bloque y mete las preguntas ahí', async () => {
    escribirPreguntas.mockResolvedValue({ preguntas: [pregunta('El remito se revisa contra el pedido')] });

    const resultado = await herramientas().write_questions.execute(
      {
        sectionId: 'S1',
        title: 'Examen final',
        order: 2,
        blockTitle: 'Recepción de pedidos',
        lessons: ['S1.L1']
      },
      OPCIONES
    );

    expect(createExerciseSectionService).toHaveBeenCalledWith(
      ID.ejercicio,
      expect.objectContaining({ title: 'Recepción de pedidos' })
    );

    const enviadas = vi.mocked(updateExerciseService).mock.calls[0][1].questions ?? [];

    expect(enviadas).toHaveLength(1);
    expect(enviadas[0]).toMatchObject({ exerciseSectionId: ID.bloque });
    expect(resultado).toMatchObject({ exerciseSectionId: ID.bloque, added: 1 });
  });

  it('sobre un ejercicio que ya existe agrega a continuación de lo que tiene', async () => {
    vi.mocked(getExercise).mockResolvedValue({
      id: ID.ejercicio,
      title: 'Autoevaluación de recepción',
      questions: [{ id: 1 }, { id: 2 }]
    } as never);
    escribirPreguntas.mockResolvedValue({ preguntas: [pregunta('El remito se revisa contra el pedido')] });

    await herramientas().write_questions.execute({ exerciseId: ID.ejercicio, lessons: ['S1.L1'] }, OPCIONES);

    expect(createExercise).not.toHaveBeenCalled();

    const enviadas = vi.mocked(updateExerciseService).mock.calls[0][1].questions ?? [];

    expect(enviadas).toHaveLength(1);
    expect(enviadas[0]).toMatchObject({ order: 2 });
  });

  /** Una lección vacía no sostiene ninguna pregunta, y el escritor ni se llama. */
  it('no gasta la llamada al escritor si la lección todavía no tiene texto', async () => {
    vi.mocked(getCourseLessonContents).mockResolvedValue([
      { id: ID.leccion, title: 'Qué se recibe y qué no', content: null }
    ] as never);

    const resultado = await herramientas().write_questions.execute(
      { sectionId: 'S1', title: 'Autoevaluación', order: 1, lessons: ['S1.L1'] },
      OPCIONES
    );

    expect(escribirPreguntas).not.toHaveBeenCalled();
    expect(resultado.ok).toBe(false);
  });
});
