import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QUESTION_TYPE_IDS } from '@cio/question-types';

/**
 * La clave de respuestas de un cuestionario no le llega al alumno antes de entregar.
 *
 * Hasta 2026-11-02 la API le mandaba al navegador del alumno, con las preguntas,
 * cuál era la opción correcta (`isCorrect`), el valor de las numéricas
 * (`correctValue`, `tolerance`) y la cita de la fuente que justifica la respuesta
 * (`evidence`). La pantalla no los mostraba mientras contestaba, pero estaban a
 * un clic en las herramientas del navegador.
 *
 * La regla, decidida con el usuario: antes de entregar, nada; entregó y no puede
 * volver a intentar, la clave entera (la revisión le marca la correcta); entregó
 * en un examen con reintento, sólo lo que ya le dijeron sus intentos corregidos.
 */

const falso = vi.hoisted(() => ({
  esDelEquipo: vi.fn(),
  getExercise: vi.fn(),
  respuestas: vi.fn()
}));

vi.mock('@cio/db/queries/group', () => ({ isCourseTeamMemberOrOrgAdmin: falso.esDelEquipo }));
vi.mock('@cio/db/queries/agent', () => ({
  getLessonCourseBinding: vi.fn(),
  getExerciseCourseBinding: vi.fn(),
  getCourseSectionBinding: vi.fn()
}));
vi.mock('@cio/db/queries/submission', () => ({ getAnswersOfProfileForExercise: falso.respuestas }));
vi.mock('@api/services/lesson/lesson', () => ({ getLesson: vi.fn() }));
vi.mock('@api/services/exercise/exercise', () => ({ getExercise: falso.getExercise }));

const { exerciseForViewer } = await import('@api/services/course/locked-content');

const CURSO = 'curso-a';
const ALUMNO = 'alumno-1';

/** Un cuestionario con los tipos de pregunta que hay en producción, más el banco de palabras. */
function cuestionario(estado: { isComplete: boolean; allowMultipleAttempts: boolean; isUnlocked?: boolean }) {
  const unica = {
    id: 1,
    questionTypeId: QUESTION_TYPE_IDS.RADIO,
    title: '¿Qué se hace primero al abrir el local?',
    points: 1,
    settings: { evidence: 'Lo primero es abrir la caja con el fondo fijo.' },
    options: [
      { id: 11, label: 'Abrir la caja', isCorrect: true },
      { id: 12, label: 'Reponer la heladera', isCorrect: false },
      { id: 13, label: 'Barrer la vereda', isCorrect: false }
    ]
  };

  return {
    id: 'ejercicio-1',
    courseId: CURSO,
    title: 'Examen final',
    isUnlocked: estado.isUnlocked ?? true,
    isComplete: estado.isComplete,
    allowMultipleAttempts: estado.allowMultipleAttempts,
    questions: [
      unica,
      {
        id: 2,
        questionTypeId: QUESTION_TYPE_IDS.CHECKBOX,
        title: '¿Qué se controla en la recepción?',
        points: 2,
        settings: { evidence: 'Se controlan la cantidad y el vencimiento.' },
        options: [
          { id: 21, label: 'La cantidad', isCorrect: true },
          { id: 22, label: 'El vencimiento', isCorrect: true },
          { id: 23, label: 'El color de la caja', isCorrect: false }
        ]
      },
      {
        id: 3,
        questionTypeId: QUESTION_TYPE_IDS.TRUE_FALSE,
        title: 'Un pedido por mensaje personal cuenta como pedido.',
        points: 1,
        settings: { evidence: 'Un pedido por mensaje personal no cuenta como pedido.' },
        options: [
          { id: 31, label: 'Verdadero', isCorrect: false },
          { id: 32, label: 'Falso', isCorrect: true }
        ]
      },
      {
        id: 4,
        questionTypeId: QUESTION_TYPE_IDS.NUMERIC,
        title: '¿Cuántos minutos dura el arqueo?',
        points: 1,
        settings: { correctValue: 15, tolerance: 0, evidence: 'El arqueo dura 15 minutos.' },
        options: []
      },
      {
        id: 5,
        questionTypeId: QUESTION_TYPE_IDS.SHORT_ANSWER,
        title: '¿Con qué criterio se repone?',
        points: 1,
        settings: { correctAnswers: ['FIFO'], required: true },
        options: []
      },
      {
        id: 6,
        questionTypeId: QUESTION_TYPE_IDS.WORD_BANK,
        title: 'Completá: primero ___, después ___.',
        points: 1,
        settings: { correctAnswers: ['cobrar', 'embolsar'], distractors: ['barrer'] },
        options: []
      }
    ],
    sections: [{ id: 's1', title: 'Parte 1', questions: [unica] }]
  };
}

type Cuestionario = ReturnType<typeof cuestionario>;
type Pregunta = Cuestionario['questions'][number];

const pregunta = (ejercicio: Cuestionario, id: number) => ejercicio.questions.find((q) => q.id === id) as Pregunta;
const clave = (ejercicio: Cuestionario, id: number) =>
  pregunta(ejercicio, id).options.map((o) => [o.id, 'isCorrect' in o ? o.isCorrect : 'no llegó']);

/** Toda clave de un objeto, a cualquier profundidad. */
function clavesDe(valor: unknown, acumuladas = new Set<string>()): Set<string> {
  if (Array.isArray(valor)) valor.forEach((v) => clavesDe(v, acumuladas));
  else if (valor && typeof valor === 'object') {
    for (const [k, v] of Object.entries(valor)) {
      acumuladas.add(k);
      clavesDe(v, acumuladas);
    }
  }
  return acumuladas;
}

async function loQueRecibe(ejercicio: Cuestionario, quien = ALUMNO) {
  falso.getExercise.mockResolvedValue(ejercicio);
  return (await exerciseForViewer(CURSO, 'ejercicio-1', quien)) as Cuestionario;
}

beforeEach(() => {
  vi.clearAllMocks();
  falso.esDelEquipo.mockResolvedValue(false);
  falso.respuestas.mockResolvedValue([]);
});

describe('antes de entregar', () => {
  it('al alumno no le llega nada de la clave, ni en las preguntas sueltas ni en las de una sección', async () => {
    const recibe = await loQueRecibe(cuestionario({ isComplete: false, allowMultipleAttempts: false }));
    const claves = clavesDe(recibe);

    for (const respuesta of ['isCorrect', 'correctValue', 'tolerance', 'evidence', 'acceptedAnswers']) {
      expect(claves.has(respuesta), respuesta).toBe(false);
    }
    expect(pregunta(recibe, 5).settings).toEqual({ required: true });
    expect(recibe.sections[0].questions[0].options).toEqual([
      { id: 11, label: 'Abrir la caja' },
      { id: 12, label: 'Reponer la heladera' },
      { id: 13, label: 'Barrer la vereda' }
    ]);
  });

  it('le llega todo lo que necesita para contestar', async () => {
    const recibe = await loQueRecibe(cuestionario({ isComplete: false, allowMultipleAttempts: false }));

    expect(recibe.questions.map((q) => [q.id, q.title, q.points])).toEqual(
      cuestionario({ isComplete: false, allowMultipleAttempts: false }).questions.map((q) => [q.id, q.title, q.points])
    );
    expect(pregunta(recibe, 2).options.map((o) => o.label)).toEqual([
      'La cantidad',
      'El vencimiento',
      'El color de la caja'
    ]);
    // El banco de palabras arma con éstas las fichas que el alumno arrastra.
    expect(pregunta(recibe, 6).settings).toEqual({ correctAnswers: ['cobrar', 'embolsar'], distractors: ['barrer'] });
  });

  it('no le toca el ejercicio a quien lo pidió después (la clave sigue en el original)', async () => {
    const original = cuestionario({ isComplete: false, allowMultipleAttempts: false });
    await loQueRecibe(original);

    expect(pregunta(original, 4).settings).toMatchObject({ correctValue: 15, evidence: 'El arqueo dura 15 minutos.' });
    expect(clave(original, 1)).toEqual([
      [11, true],
      [12, false],
      [13, false]
    ]);
  });
});

describe('después de entregar, sin otro intento', () => {
  it('le llega la clave entera: la revisión le marca la correcta de cada pregunta', async () => {
    const ejercicio = cuestionario({ isComplete: true, allowMultipleAttempts: false });

    expect(await loQueRecibe(ejercicio)).toEqual(cuestionario({ isComplete: true, allowMultipleAttempts: false }));
  });
});

describe('después de entregar un examen que se puede volver a rendir', () => {
  const examen = () => cuestionario({ isComplete: true, allowMultipleAttempts: true });

  it('de las opciones que eligió sabe si acertó; de la correcta que no eligió, nada', async () => {
    falso.respuestas.mockResolvedValue([
      { questionId: 1, answerData: { type: 'RADIO', optionId: 12 } },
      { questionId: 2, answerData: { type: 'CHECKBOX', optionIds: [21, 23] } }
    ]);

    const recibe = await loQueRecibe(examen());

    expect(falso.respuestas).toHaveBeenCalledWith('ejercicio-1', ALUMNO);
    expect(clave(recibe, 1)).toEqual([
      [11, 'no llegó'],
      [12, false],
      [13, 'no llegó']
    ]);
    expect(clave(recibe, 2)).toEqual([
      [21, true],
      [22, 'no llegó'],
      [23, false]
    ]);
    expect(pregunta(recibe, 1).settings).toEqual({});
    expect(pregunta(recibe, 4).settings).toEqual({});
  });

  it('cuenta las opciones de todos sus intentos, no sólo del último', async () => {
    falso.respuestas.mockResolvedValue([
      { questionId: 1, answerData: { type: 'RADIO', optionId: 12 } },
      { questionId: 1, answerData: { type: 'RADIO', optionId: 11 } }
    ]);

    expect(clave(await loQueRecibe(examen()), 1)).toEqual([
      [11, true],
      [12, false],
      [13, 'no llegó']
    ]);
  });

  it('una verdadero/falso que contestó le llega entera: saber si acertó ya es saber la respuesta', async () => {
    falso.respuestas.mockResolvedValue([{ questionId: 3, answerData: { type: 'TRUE_FALSE', value: true } }]);

    expect(pregunta(await loQueRecibe(examen()), 3)).toEqual(pregunta(examen(), 3));
  });

  it('una que no contestó, no', async () => {
    falso.respuestas.mockResolvedValue([{ questionId: 1, answerData: { type: 'RADIO', optionId: 11 } }]);

    const recibe = await loQueRecibe(examen());

    expect(clave(recibe, 3)).toEqual([
      [31, 'no llegó'],
      [32, 'no llegó']
    ]);
    expect(pregunta(recibe, 3).settings).toEqual({});
  });
});

describe('el equipo del curso', () => {
  it('ve la clave entera aunque no haya entregado nada: arma el cuestionario', async () => {
    falso.esDelEquipo.mockResolvedValue(true);

    const recibe = await loQueRecibe(cuestionario({ isComplete: false, allowMultipleAttempts: true }), 'docente-1');

    expect(recibe).toEqual(cuestionario({ isComplete: false, allowMultipleAttempts: true }));
    expect(falso.respuestas).not.toHaveBeenCalled();
  });
});

it('un cuestionario bloqueado le sigue llegando al alumno sin preguntas', async () => {
  const recibe = await loQueRecibe(
    cuestionario({ isComplete: false, allowMultipleAttempts: false, isUnlocked: false })
  );

  expect(recibe.questions).toEqual([]);
  expect(recibe.sections).toEqual([]);
});
