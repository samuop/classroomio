import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Un cambio que toca las notas de alumnos que ya entregaron lo decide la
 * docente, no el modelo.
 *
 * ── Qué pasó (producción, 2026-11-07) ────────────────────────────────────────
 *
 * Un pedido de revisión terminó con doce preguntas nuevas en un examen final
 * que cincuenta alumnos ya habían rendido. El máximo de cada entrega se calcula
 * con las preguntas de hoy, así que las cincuenta notas pasaron de ~87 % a ~42 %
 * en Calificaciones sin que nadie tocara una entrega.
 *
 * Esta suite fija que, con entregas, ninguna de las cuatro herramientas que
 * pueden mover notas escribe: proponen, con el efecto calculado; que lo
 * aprobado se aplica contra el ejercicio de AHORA; y que la ronda siguiente se
 * entera de cómo resolvió la docente.
 *
 * Curso inventado, de un almacén que no existe.
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

vi.mock('@cio/db/queries/exercise', async (original) => ({
  ...(await original<typeof import('@cio/db/queries/exercise')>()),
  getExerciseSectionsByExerciseId: vi.fn(async () => [])
}));

vi.mock('@cio/db/queries/lesson/language', () => ({
  getCourseLessonContents: vi.fn()
}));

vi.mock('@cio/db/queries/agent', async (original) => ({
  ...(await original<typeof import('@cio/db/queries/agent')>()),
  entregasDelEjercicio: vi.fn(),
  guardarPropuesta: vi.fn(async () => {})
}));

vi.mock('@api/services/agent/chat-context', async (original) => ({
  ...(await original<typeof import('@api/services/agent/chat-context')>()),
  verifySectionBelongsToCourse: vi.fn(),
  verifyLessonBelongsToCourse: vi.fn(),
  verifyExerciseBelongsToCourse: vi.fn()
}));

import {
  createExerciseSectionService,
  deleteExerciseForCourseService,
  getExercise,
  updateExerciseService
} from '@api/services/exercise/exercise';
import { getCourseLessonContents } from '@cio/db/queries/lesson/language';
import { entregasDelEjercicio, guardarPropuesta, type PropuestaGuardada } from '@cio/db/queries/agent';
import { buildAgentTools } from '@api/services/agent/chat-tools';
import { lineasDelRegistro, registroVacio } from '@api/services/agent/round-ledger';
import { aplicarPropuesta, avisoDePropuestas, calcularImpacto } from '@api/services/agent/cambios-con-entregas';

const EXAMEN = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const CURSO = '00000000-0000-4000-8000-00000000c002';
const OPCIONES = { toolCallId: 'llamada', messages: [] };

/** Diez preguntas, doce puntos: como el examen del incidente. */
function examenRendido() {
  return {
    id: EXAMEN,
    title: 'Examen final',
    lessonId: null,
    sectionId: null,
    questions: Array.from({ length: 10 }, (_, i) => ({
      id: 100 + i,
      title: `Pregunta ${i + 1}`,
      questionTypeId: 1,
      points: i === 3 || i === 9 ? 2 : 1,
      order: i,
      exerciseSectionId: null,
      settings: {},
      options: [
        { id: 1000 + i * 2, label: 'Sí', isCorrect: true, settings: {} },
        { id: 1001 + i * 2, label: 'No', isCorrect: false, settings: {} }
      ]
    }))
  };
}

function herramientas(registro = registroVacio()) {
  return buildAgentTools('org', 'docente', CURSO, [], {
    conversationId: 'conversacion',
    isBuilding: true,
    locale: 'es',
    registro
  }) as Record<string, { execute: (args: unknown, opciones: unknown) => Promise<Record<string, unknown>> }>;
}

const UNA_PREGUNTA = {
  question: '¿Qué se anota en el remito?',
  questionTypeId: 1,
  points: 1,
  evidence: 'se anota lo que se contó',
  options: [
    { label: 'Lo que se contó', isCorrect: true },
    { label: 'Lo que dijo el chofer', isCorrect: false }
  ]
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getExercise).mockResolvedValue(examenRendido() as never);
  vi.mocked(entregasDelEjercicio).mockResolvedValue({ cantidad: 50, promedio: 10.42 });
  vi.mocked(getCourseLessonContents).mockResolvedValue([
    { id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', title: 'Recibir mercadería', content: '<p>En el remito se anota lo que se contó, nunca lo que dijo el chofer.</p>' }
  ] as never);
});

describe('con entregas, nada que mueva notas se escribe solo', () => {
  it('add_questions propone, con el máximo y el promedio de antes y de después', async () => {
    const registro = registroVacio();

    const resultado = await herramientas(registro).add_questions.execute(
      { exerciseId: EXAMEN, questions: [UNA_PREGUNTA] },
      OPCIONES
    );

    expect(updateExerciseService).not.toHaveBeenCalled();
    expect(resultado).toMatchObject({
      status: 'needs_teacher_approval',
      impact: { tipo: 'agregar', entregas: 50, maximoAntes: 12, maximoDespues: 13, promedioAntes: 87, promedioDespues: 80 }
    });
    expect(String(resultado.note)).toContain('NOTHING WAS SAVED');
    expect(guardarPropuesta).toHaveBeenCalledWith(
      expect.objectContaining({ herramienta: 'add_questions', cuerpo: expect.objectContaining({ tipo: 'agregar' }) })
    );
    // Lo que ve la docente en el resumen: que espera su aprobación, no que se hizo.
    expect(lineasDelRegistro(registro)).toEqual([
      'Propuso, para tu aprobación, un cambio en «Examen final»: 1 pregunta nueva (1 punto); ' +
        '50 entregas: el máximo pasaría de 12 a 13 y el promedio de 87 % a 80 %'
    ]);
  });

  it('update_questions propone los parches, con el enunciado antes y después', async () => {
    const resultado = await herramientas().update_questions.execute(
      { exerciseId: EXAMEN, questions: [{ id: 100, question: 'Pregunta 1, al revés' }] },
      OPCIONES
    );

    expect(updateExerciseService).not.toHaveBeenCalled();
    expect(resultado).toMatchObject({
      status: 'needs_teacher_approval',
      impact: { tipo: 'reescribir', maximoAntes: 12, maximoDespues: 12, cambios: ['«Pregunta 1» → «Pregunta 1, al revés», correcta: Sí'] }
    });
    expect(guardarPropuesta).toHaveBeenCalledWith(
      expect.objectContaining({ cuerpo: { tipo: 'reescribir', parches: [{ id: 100, question: 'Pregunta 1, al revés' }] } })
    );
  });

  it('delete_exercise propone: borrarlo borraría las entregas', async () => {
    const resultado = await herramientas().delete_exercise.execute(
      { exerciseId: EXAMEN, confirmTitle: 'Examen final' },
      OPCIONES
    );

    expect(deleteExerciseForCourseService).not.toHaveBeenCalled();
    expect(resultado).toMatchObject({ status: 'needs_teacher_approval', impact: { tipo: 'borrar', entregas: 50, maximoDespues: 0 } });
  });

  it('sin entregas, escribe como siempre', async () => {
    vi.mocked(entregasDelEjercicio).mockResolvedValue({ cantidad: 0, promedio: null });

    const resultado = await herramientas().add_questions.execute(
      { exerciseId: EXAMEN, questions: [UNA_PREGUNTA] },
      OPCIONES
    );

    expect(updateExerciseService).toHaveBeenCalledTimes(1);
    expect(guardarPropuesta).not.toHaveBeenCalled();
    expect(resultado).toMatchObject({ addedCount: 1 });
  });
});

describe('lo aprobado se aplica contra el ejercicio de ahora', () => {
  const propuesta = (cuerpo: Record<string, unknown>): PropuestaGuardada => ({
    id: 'p-1',
    estado: 'pendiente',
    herramienta: 'write_questions',
    exerciseId: EXAMEN,
    exerciseTitle: 'Examen final',
    cuerpo,
    impacto: {},
    courseId: CURSO,
    conversationId: 'conversacion',
    creadaEn: '2026-11-08T10:00:00Z'
  });

  it('agregar: crea el bloque nuevo y numera a continuación de lo que hay HOY', async () => {
    vi.mocked(createExerciseSectionService).mockResolvedValue({ id: 'bloque-nuevo' } as never);

    await aplicarPropuesta(propuesta({ tipo: 'agregar', bloqueNuevo: 'Módulo 3', preguntas: [{ question: 'Una' }, { question: 'Otra' }] }));

    expect(createExerciseSectionService).toHaveBeenCalledWith(EXAMEN, { title: 'Módulo 3', order: 0 });
    expect(vi.mocked(updateExerciseService).mock.calls[0][1].questions).toEqual([
      { question: 'Una', order: 10, exerciseSectionId: 'bloque-nuevo' },
      { question: 'Otra', order: 11, exerciseSectionId: 'bloque-nuevo' }
    ]);
  });

  it('reescribir: aplica los parches sobre las preguntas de hoy', async () => {
    await aplicarPropuesta(propuesta({ tipo: 'reescribir', parches: [{ id: 104, points: 3 }] }));

    const enviadas = vi.mocked(updateExerciseService).mock.calls[0][1].questions ?? [];

    expect(enviadas).toHaveLength(1);
    expect(enviadas[0]).toMatchObject({ id: 104, points: 3, question: 'Pregunta 5' });
  });

  it('borrar: borra el ejercicio del curso de la propuesta', async () => {
    await aplicarPropuesta(propuesta({ tipo: 'borrar' }));

    expect(deleteExerciseForCourseService).toHaveBeenCalledWith(CURSO, EXAMEN);
  });
});

describe('la ronda siguiente se entera', () => {
  const impacto = calcularImpacto({
    tipo: 'agregar',
    entregas: { cantidad: 50, promedio: 10.42 },
    maximoAntes: 12,
    maximoDespues: 25,
    agregadas: { cantidad: 12, puntos: 13 }
  });
  const base = {
    herramienta: 'write_questions',
    exerciseId: EXAMEN,
    exerciseTitle: 'Examen final',
    cuerpo: {},
    impacto: impacto as unknown as Record<string, unknown>,
    courseId: CURSO,
    conversationId: 'conversacion',
    creadaEn: '2026-11-08T10:00:00Z'
  };

  it('dice cuál espera, cuál se aplicó y cuál canceló ella', () => {
    const aviso = avisoDePropuestas([
      { ...base, id: 'a', estado: 'pendiente' },
      { ...base, id: 'b', estado: 'aplicada' },
      { ...base, id: 'c', estado: 'cancelada' }
    ]);

    expect(aviso).toContain('WAITING for her decision');
    expect(aviso).toContain('APPROVED by her and APPLIED by the server');
    expect(aviso).toContain('CANCELLED by her');
    expect(aviso).toContain('12 preguntas nuevas (13 puntos); 50 entregas: el máximo pasaría de 12 a 25 y el promedio de 87 % a 42 %');
  });

  it('sin propuestas no dice nada', () => {
    expect(avisoDePropuestas([])).toBe('');
  });
});
