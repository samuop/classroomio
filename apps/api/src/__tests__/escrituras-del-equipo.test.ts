/**
 * Escribir el contenido de un curso es del equipo, no del alumno.
 *
 * Hasta 2026-11-02 las rutas que crean, editan, borran o reordenan lecciones,
 * secciones y ejercicios, las que escriben el texto de una lección y la de la
 * asistencia pedían sólo ser miembro del curso. La pantalla no le ofrecía nada de
 * eso al alumno, pero cualquier alumno podía hacerlo llamando a la API: borrar
 * una lección, cambiar la respuesta correcta de su examen, marcarse presente. Y
 * los comentarios de una lección los editaba o borraba cualquiera, no sólo quien
 * los escribió.
 *
 * Además, ninguna de esas rutas miraba de qué curso era el id que recibía: el
 * docente de un curso podía editar, por id, una lección de un curso ajeno.
 *
 * Contra los routers reales y los middlewares reales; son de mentira la base (los
 * roles y de qué curso es cada id) y los servicios que escriben, para saber si se
 * llegó a escribir.
 */
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const CURSO = '00000000-0000-4000-8000-0000000c0001';
const OTRO_CURSO = '00000000-0000-4000-8000-0000000c0002';
const LECCION = '00000000-0000-4000-8000-00000001e001';
const LECCION_AJENA = '00000000-0000-4000-8000-00000001e002';
const SECCION = 'seccion-propia';
const SECCION_AJENA = 'seccion-ajena';
const EJERCICIO = 'ejercicio-propio';
const EJERCICIO_AJENO = 'ejercicio-ajeno';

const DOCENTE = { id: 'docente-1', email: 'docente@ejemplo.test', role: null };
const ALUMNO = { id: 'alumno-1', email: 'alumno@ejemplo.test', role: null };

const falso = vi.hoisted(() => ({
  escrituras: [] as string[],
  comentario: vi.fn()
}));

/** Un servicio de mentira que anota que se lo llamó. */
function servicio(nombre: string) {
  return vi.fn(async () => {
    falso.escrituras.push(nombre);
    return { id: nombre };
  });
}

vi.mock('@cio/db/queries/group', () => ({
  // Las dos personas son del curso; sólo la docente es del equipo.
  isUserCourseMemberOrOrgAdmin: vi.fn(async (courseId: string) => courseId === CURSO),
  isCourseTeamMemberOrOrgAdmin: vi.fn(
    async (courseId: string, userId: string) => courseId === CURSO && userId === DOCENTE.id
  ),
  getGroupMemberIdByCourseAndProfile: vi.fn(async (_courseId: string, userId: string) => `gm-${userId}`)
}));
vi.mock('@api/services/course/course', () => ({ ensureProgramCourseAccess: vi.fn(async () => false) }));

// De qué curso es cada id: lo que lee el control nuevo.
const deQueCurso = (ajeno: string) => async (id: string) => ({
  courseId: id === ajeno ? OTRO_CURSO : CURSO,
  title: id
});
vi.mock('@cio/db/queries/agent', () => ({
  getLessonCourseBinding: vi.fn(deQueCurso(LECCION_AJENA)),
  getExerciseCourseBinding: vi.fn(deQueCurso(EJERCICIO_AJENO)),
  getCourseSectionBinding: vi.fn(deQueCurso(SECCION_AJENA))
}));
vi.mock('@cio/db/queries/lesson', () => ({ getLessonCommentAuthorAndCourse: falso.comentario }));

vi.mock('@api/services/lesson', () => ({
  createLesson: servicio('createLesson'),
  updateLessonService: servicio('updateLessonService'),
  deleteLessonService: servicio('deleteLessonService'),
  reorderLessons: servicio('reorderLessons'),
  createLessonCommentService: servicio('createLessonCommentService'),
  updateLessonCommentService: servicio('updateLessonCommentService'),
  deleteLessonCommentService: servicio('deleteLessonCommentService'),
  upsertLessonCompletionService: servicio('upsertLessonCompletionService'),
  getLessonCommentsPaginated: vi.fn(async () => ({ items: [] })),
  getLessonCompletionService: vi.fn(async () => null),
  getLessonHistoryService: vi.fn(async () => []),
  listLessons: vi.fn(async () => [])
}));
vi.mock('@api/services/lesson-language', () => ({
  upsertLessonLanguageService: servicio('upsertLessonLanguageService'),
  updateLessonLanguageService: servicio('updateLessonLanguageService'),
  getLessonLanguage: vi.fn(async () => null),
  listLessonLanguages: vi.fn(async () => [])
}));
vi.mock('@api/services/course/section', () => ({
  createCourseSection: servicio('createCourseSection'),
  promoteUngroupedSection: servicio('promoteUngroupedSection'),
  updateCourseSectionService: servicio('updateCourseSectionService'),
  deleteCourseSectionService: servicio('deleteCourseSectionService'),
  reorderCourseSections: servicio('reorderCourseSections')
}));
vi.mock('@api/services/exercise/exercise', () => ({
  createExercise: servicio('createExercise'),
  createExerciseFromTemplate: servicio('createExerciseFromTemplate'),
  updateExerciseService: servicio('updateExerciseService'),
  deleteExerciseForCourseService: servicio('deleteExerciseForCourseService'),
  deleteExerciseService: servicio('deleteExerciseService'),
  getExercise: vi.fn(),
  listExercises: vi.fn(async () => [])
}));
vi.mock('@api/services/exercise/template', () => ({
  fetchTemplateById: vi.fn(async () => ({ questionnaire: { questions: [] } })),
  fetchAllTemplatesMetadata: vi.fn(),
  fetchTemplatesByTag: vi.fn()
}));
vi.mock('@api/services/exercise/video-recording', () => ({
  initVideoRecordingUpload: vi.fn(),
  completeVideoRecordingUpload: vi.fn(),
  getVideoRecordingPlaybackUrl: vi.fn()
}));
vi.mock('@api/services/organization/automation-usage', () => ({
  assertMcpAutomationUsageAllowed: vi.fn(),
  recordMcpAutomationUsage: vi.fn()
}));
vi.mock('@api/services/submission', () => ({
  createSubmissionService: servicio('createSubmissionService'),
  listExerciseSubmissionsOverview: vi.fn()
}));
vi.mock('@api/services/course/locked-content', () => ({
  assertLessonWorkable: vi.fn(async () => {}),
  assertExerciseWorkable: vi.fn(async () => {}),
  canReadLesson: vi.fn(async () => true),
  lessonForViewer: vi.fn(async () => ({})),
  lessonsForViewer: vi.fn(async (_c: string, lecciones: unknown[]) => lecciones),
  exerciseForViewer: vi.fn(async () => ({})),
  exercisesForViewer: vi.fn(async (_c: string, ejercicios: unknown[]) => ejercicios)
}));
vi.mock('@api/utils/lesson', () => ({ generateLessonPdf: vi.fn() }));
vi.mock('@api/services/attendance', () => ({ upsertAttendanceService: servicio('upsertAttendanceService') }));

const { lessonRouter } = await import('@api/routes/course/lesson');
const { sectionRouter } = await import('@api/routes/course/section');
const { exerciseRouter } = await import('@api/routes/course/exercise');
const { attendanceRouter } = await import('@api/routes/course/attendance');

/** Los routers montados como en `routes/course/course.ts`, detrás de una sesión armada a mano. */
function app(quien: typeof DOCENTE) {
  return new Hono()
    .use('*', async (c, next) => {
      c.set('user' as never, quien as never);
      c.set('session' as never, { id: 's1' } as never);
      await next();
    })
    .route('/course/:courseId/lesson', lessonRouter)
    .route('/course/:courseId/section', sectionRouter)
    .route('/course/:courseId/exercise', exerciseRouter)
    .route('/course/:courseId/attendance', attendanceRouter);
}

async function pedir(quien: typeof DOCENTE, metodo: string, ruta: string, cuerpo?: unknown) {
  const res = await app(quien).request(ruta, {
    method: metodo,
    headers: { 'Content-Type': 'application/json' },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo)
  });
  return res.status;
}

const C = `/course/${CURSO}`;

/** Cada escritura de contenido: [qué es, método, ruta, cuerpo, servicio que escribe]. */
const ESCRITURAS: Array<[string, string, string, unknown, string]> = [
  ['crear una lección', 'POST', `${C}/lesson`, { title: 'Nueva', courseId: CURSO }, 'createLesson'],
  ['editar una lección', 'PUT', `${C}/lesson/${LECCION}`, { title: 'Otro título' }, 'updateLessonService'],
  ['borrar una lección', 'DELETE', `${C}/lesson/${LECCION}`, undefined, 'deleteLessonService'],
  ['reordenar lecciones', 'POST', `${C}/lesson/reorder`, { lessons: [{ id: LECCION, order: 1 }] }, 'reorderLessons'],
  [
    'escribir el texto de una lección',
    'POST',
    `${C}/lesson/${LECCION}/language`,
    { locale: 'es', content: '<p>Otro texto</p>' },
    'upsertLessonLanguageService'
  ],
  [
    'editar el texto de una lección',
    'PUT',
    `${C}/lesson/${LECCION}/language/es`,
    { content: '<p>Otro texto</p>' },
    'updateLessonLanguageService'
  ],
  ['crear una sección', 'POST', `${C}/section`, { title: 'Parte 2', courseId: CURSO }, 'createCourseSection'],
  [
    'agrupar lo suelto en una sección',
    'POST',
    `${C}/section/promote-ungrouped`,
    { title: 'Parte 1' },
    'promoteUngroupedSection'
  ],
  ['renombrar una sección', 'PUT', `${C}/section/${SECCION}`, { title: 'Otra' }, 'updateCourseSectionService'],
  ['borrar una sección', 'DELETE', `${C}/section/${SECCION}`, undefined, 'deleteCourseSectionService'],
  [
    'reordenar secciones',
    'POST',
    `${C}/section/reorder`,
    { sections: [{ id: SECCION, order: 0 }] },
    'reorderCourseSections'
  ],
  ['crear un ejercicio', 'POST', `${C}/exercise`, { title: 'Cuestionario', courseId: CURSO }, 'createExercise'],
  [
    'crear un ejercicio de plantilla',
    'POST',
    `${C}/exercise/from-template`,
    { templateId: 1 },
    'createExerciseFromTemplate'
  ],
  [
    'editar un ejercicio (y sus respuestas)',
    'PUT',
    `${C}/exercise/${EJERCICIO}`,
    { title: 'Otro' },
    'updateExerciseService'
  ],
  ['borrar un ejercicio', 'DELETE', `${C}/exercise/${EJERCICIO}`, undefined, 'deleteExerciseForCourseService'],
  [
    'marcar asistencia',
    'POST',
    `${C}/attendance`,
    { courseId: CURSO, lessonId: LECCION, studentId: 'gm-alumno-1', isPresent: true },
    'upsertAttendanceService'
  ]
];

beforeEach(() => {
  falso.escrituras.length = 0;
  falso.comentario.mockReset();
});

describe('el alumno no escribe el contenido del curso', () => {
  it.each(ESCRITURAS)('%s: 403 y no se escribe nada', async (_que, metodo, ruta, cuerpo) => {
    expect(await pedir(ALUMNO, metodo, ruta, cuerpo)).toBe(403);
    expect(falso.escrituras).toEqual([]);
  });
});

describe('el equipo sí', () => {
  it.each(ESCRITURAS)('%s', async (_que, metodo, ruta, cuerpo, escribe) => {
    expect(await pedir(DOCENTE, metodo, ruta, cuerpo)).toBeLessThan(300);
    expect(falso.escrituras).toEqual([escribe]);
  });
});

describe('lo de otro curso no existe, aunque quien pide sea del equipo', () => {
  const AJENAS: Array<[string, string, string, unknown]> = [
    ['editar una lección ajena', 'PUT', `${C}/lesson/${LECCION_AJENA}`, { title: 'Mía' }],
    ['borrar una lección ajena', 'DELETE', `${C}/lesson/${LECCION_AJENA}`, undefined],
    ['mover una lección propia a una sección ajena', 'PUT', `${C}/lesson/${LECCION}`, { sectionId: SECCION_AJENA }],
    [
      'reordenar con una lección ajena en la lista',
      'POST',
      `${C}/lesson/reorder`,
      {
        lessons: [
          { id: LECCION, order: 0 },
          { id: LECCION_AJENA, order: 1 }
        ]
      }
    ],
    ['escribir el texto de una lección ajena', 'POST', `${C}/lesson/${LECCION_AJENA}/language`, { locale: 'es' }],
    ['editar el texto de una lección ajena', 'PUT', `${C}/lesson/${LECCION_AJENA}/language/es`, { content: 'x' }],
    ['renombrar una sección ajena', 'PUT', `${C}/section/${SECCION_AJENA}`, { title: 'Mía' }],
    ['borrar una sección ajena', 'DELETE', `${C}/section/${SECCION_AJENA}`, undefined],
    [
      'reordenar con una sección ajena',
      'POST',
      `${C}/section/reorder`,
      { sections: [{ id: SECCION_AJENA, order: 0 }] }
    ],
    ['editar un ejercicio ajeno', 'PUT', `${C}/exercise/${EJERCICIO_AJENO}`, { title: 'Mío' }],
    [
      'crear un ejercicio en una sección ajena',
      'POST',
      `${C}/exercise`,
      { title: 'X', courseId: CURSO, sectionId: SECCION_AJENA }
    ],
    [
      'marcar asistencia en una lección ajena',
      'POST',
      `${C}/attendance`,
      { courseId: CURSO, lessonId: LECCION_AJENA, studentId: 'gm-x', isPresent: true }
    ]
  ];

  it.each(AJENAS)('%s: 404 y no se escribe nada', async (_que, metodo, ruta, cuerpo) => {
    expect(await pedir(DOCENTE, metodo, ruta, cuerpo)).toBe(404);
    expect(falso.escrituras).toEqual([]);
  });

  it('un cuerpo que nombra otro curso que el de la ruta no pasa', async () => {
    expect(await pedir(DOCENTE, 'POST', `${C}/exercise`, { title: 'X', courseId: OTRO_CURSO })).toBe(400);
    expect(
      await pedir(DOCENTE, 'POST', `${C}/attendance`, {
        courseId: OTRO_CURSO,
        lessonId: LECCION,
        studentId: 'gm-x',
        isPresent: true
      })
    ).toBe(400);
    expect(falso.escrituras).toEqual([]);
  });
});

describe('los comentarios de una lección', () => {
  const editar = (quien: typeof DOCENTE) => pedir(quien, 'PUT', `${C}/lesson/comment/7`, { comment: 'Otro texto' });
  const borrar = (quien: typeof DOCENTE) => pedir(quien, 'DELETE', `${C}/lesson/comment/7`);

  it('quien lo escribió lo edita y lo borra', async () => {
    falso.comentario.mockResolvedValue({ authorId: `gm-${ALUMNO.id}`, courseId: CURSO });

    expect(await editar(ALUMNO)).toBe(200);
    expect(await borrar(ALUMNO)).toBe(200);
    expect(falso.escrituras).toEqual(['updateLessonCommentService', 'deleteLessonCommentService']);
  });

  it('otro alumno no', async () => {
    falso.comentario.mockResolvedValue({ authorId: 'gm-otro-alumno', courseId: CURSO });

    expect(await editar(ALUMNO)).toBe(403);
    expect(await borrar(ALUMNO)).toBe(403);
    expect(falso.escrituras).toEqual([]);
  });

  it('el equipo modera los de cualquiera', async () => {
    falso.comentario.mockResolvedValue({ authorId: 'gm-otro-alumno', courseId: CURSO });

    expect(await borrar(DOCENTE)).toBe(200);
    expect(falso.escrituras).toEqual(['deleteLessonCommentService']);
  });

  it('uno de otro curso no se alcanza desde la URL de un curso propio', async () => {
    falso.comentario.mockResolvedValue({ authorId: 'gm-alguien', courseId: OTRO_CURSO });

    expect(await borrar(DOCENTE)).toBe(404);
    expect(falso.escrituras).toEqual([]);
  });

  it('comentar sigue siendo de todos, en una lección del curso', async () => {
    const comentar = (leccion: string) =>
      pedir(ALUMNO, 'POST', `${C}/lesson/${leccion}/comment`, { lessonId: leccion, comment: 'Una duda' });

    expect(await comentar(LECCION)).toBe(201);
    expect(await comentar(LECCION_AJENA)).toBe(404);
    expect(falso.escrituras).toEqual(['createLessonCommentService']);
  });
});

describe('lo que el alumno hace en el curso sigue andando', () => {
  it('lee las lecciones, completa una y entrega un ejercicio', async () => {
    expect(await pedir(ALUMNO, 'GET', `${C}/lesson?courseId=${CURSO}`)).toBe(200);
    expect(await pedir(ALUMNO, 'PUT', `${C}/lesson/${LECCION}/completion`, { isComplete: true })).toBe(200);
    expect(
      await pedir(ALUMNO, 'POST', `${C}/exercise/${EJERCICIO}/submission`, {
        exerciseId: EJERCICIO,
        answers: [{ questionId: 1, optionId: 2 }]
      })
    ).toBe(201);
    expect(falso.escrituras).toEqual(['upsertLessonCompletionService', 'createSubmissionService']);
  });
});
