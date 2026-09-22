import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ContentType } from '@cio/utils/constants';

/**
 * Una conversación NUEVA sobre un curso YA construido no puede duplicarlo.
 *
 * ── Lo que pasó (producción, 2026-09-21) ─────────────────────────────────────
 *
 * La docente abrió un chat nuevo para sumarle la sección 3 a un curso con tres
 * secciones hechas. El modelo rearmó el plan entero y, en la versión aprobada,
 * les sacó el «Sección N:» a los títulos. El registro del plan vive por
 * conversación, así que no había ninguna atadura: el control de avance comparó
 * títulos a pelo, no encontró ninguna sección, y ordenó construirlas «con todo
 * lo de adentro». Las herramientas, que sólo reusaban por atadura, obedecieron.
 * En dos minutos el curso —publicado— tenía dos secciones duplicadas con sus
 * lecciones y una tercera paralela.
 *
 * Los títulos de acá tienen la forma de los de ese curso, no su contenido.
 */

// El entorno de tests de la API es `node` y no puede cargar jsdom (ver
// pasajes-sin-fuente.test.ts). Ninguno de estos caminos sanea HTML.
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

vi.mock('@cio/db/queries/agent', async (original) => ({
  ...(await original<typeof import('@cio/db/queries/agent')>()),
  bindPlanItem: vi.fn(),
  // Conversación nueva: ningún ítem del plan está atado a nada todavía.
  resolvePlanBinding: vi.fn().mockResolvedValue(null)
}));

vi.mock('@api/services/agent/chat-context', async (original) => ({
  ...(await original<typeof import('@api/services/agent/chat-context')>()),
  verifySectionBelongsToCourse: vi.fn(),
  verifyLessonBelongsToCourse: vi.fn(),
  verifyExerciseBelongsToCourse: vi.fn()
}));

import { listCourseSections, createCourseSection } from '@api/services/course/section';
import { getCourseContentItems } from '@cio/db/queries/course/content';
import { createLesson } from '@api/services/lesson/lesson';
import { createExercise } from '@api/services/exercise/exercise';
import { bindPlanItem } from '@cio/db/queries/agent';
import { buildAgentTools } from '@api/services/agent/chat-tools';
import { buildPlanProgressAnchor } from '@api/services/agent/chat-context';
import { claveDeTitulo, mismoTitulo, piezaConContenido, piezaEquivalente } from '@api/services/agent/pieza-existente';

// Ids con forma de UUID porque eso es lo que son en la base, y desde que las
// herramientas aceptan manijas (`S1.L2`) un «sec-1» ya no pasa: no es ni una
// cosa ni la otra, que es justo la forma de los ids que el modelo inventaba.
const ID_SECCION_1 = '11111111-1111-4111-8111-111111111111';
const ID_SECCION_3 = '33333333-3333-4333-8333-333333333333';
const ID_LECCION = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ID_EJERCICIO = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const SECCION_1 = { id: ID_SECCION_1, title: 'Sección 1: Historia de la Empresa', order: 1 };
const SECCION_3 = { id: ID_SECCION_3, title: 'Sección 3: Atención en el Mostrador', order: 3 };
const SECCIONES = [SECCION_1, SECCION_3];

/** Filas como las devuelve `getCourseContentItems`: el tipo en MAYÚSCULAS. */
const LECCION_ESCRITA = {
  id: ID_LECCION,
  type: ContentType.Lesson,
  title: 'Conocer los orígenes y la evolución de la compañía',
  sectionId: ID_SECCION_1,
  order: 1,
  hasNoteContent: true,
  hasSlideContent: false,
  videosCount: 0,
  questionCount: null
};
const AUTOEVALUACION = {
  id: ID_EJERCICIO,
  type: ContentType.Exercise,
  title: 'Autoevaluación: Historia de la Empresa',
  sectionId: ID_SECCION_1,
  order: 4,
  hasNoteContent: null,
  hasSlideContent: false,
  videosCount: 0,
  questionCount: 7
};
const ITEMS = [LECCION_ESCRITA, AUTOEVALUACION];

describe('la clave de un título', () => {
  it('reconoce la sección aunque el plan le saque el «Sección N:» — el caso de producción', () => {
    expect(mismoTitulo(SECCION_1.title, 'Historia de la Empresa')).toBe(true);
  });

  it('y aunque la renumere, que fue el intento anterior del mismo plan', () => {
    expect(mismoTitulo('Sección 6: Evaluación Final Integradora', 'Sección 5: Evaluación Final Integradora')).toBe(true);
  });

  it('ignora tildes, mayúsculas, puntuación y otras formas de numerar', () => {
    expect(mismoTitulo('Módulo 2 - Recepción de Mercadería', 'recepcion de mercaderia')).toBe(true);
    expect(mismoTitulo('1.2 Introducción', 'Introducción')).toBe(true);
    expect(mismoTitulo('3) Cierre de caja', 'Cierre de caja.')).toBe(true);
  });

  it('no le saca a un título el número que es parte de él', () => {
    expect(claveDeTitulo('5 errores comunes al cobrar')).toBe('5 errores comunes al cobrar');
    expect(mismoTitulo('5 errores comunes al cobrar', 'Errores comunes al cobrar')).toBe(false);
  });

  it('no confunde palabras que empiezan como una numeración', () => {
    expect(claveDeTitulo('Unidades de Medida y Conversión')).toBe('unidades de medida y conversion');
  });

  /** Una clave vacía haría iguales a todas las secciones que se llaman sólo con número. */
  it('una sección que se llama sólo «Módulo 3» no queda con clave vacía', () => {
    expect(claveDeTitulo('Módulo 3')).not.toBe('');
    expect(mismoTitulo('Módulo 3', 'Módulo 4')).toBe(false);
  });

  it('dos títulos distintos siguen siendo distintos', () => {
    expect(mismoTitulo('Conocer los orígenes de la compañía', 'Conocer los orígenes y la evolución de la compañía')).toBe(false);
  });
});

describe('la pieza que ya ocupa un lugar', () => {
  it('se busca sólo dentro de su sección: cada sección tiene su propia autoevaluación', () => {
    expect(
      piezaEquivalente(ITEMS, { tipo: 'exercise', sectionId: ID_SECCION_3, titulo: AUTOEVALUACION.title })
    ).toBeUndefined();
  });

  it('compara el tipo en las dos formas en que llega', () => {
    expect(piezaEquivalente(ITEMS, { tipo: 'lesson', sectionId: ID_SECCION_1, titulo: LECCION_ESCRITA.title })?.id).toBe(
      ID_LECCION
    );
  });

  it('una lección con diapositivas o video cuenta como escrita', () => {
    expect(piezaConContenido({ ...LECCION_ESCRITA, hasNoteContent: false, videosCount: 1 })).toBe(true);
    expect(piezaConContenido({ ...LECCION_ESCRITA, hasNoteContent: false })).toBe(false);
  });
});

describe('el control de avance, contra un curso construido en otra conversación', () => {
  const plan = {
    title: 'Onboarding',
    sections: [
      {
        // Sin «Sección 1:», como en el plan que se aprobó.
        title: 'Historia de la Empresa',
        order: 0,
        items: [
          { type: 'lesson' as const, title: LECCION_ESCRITA.title, description: 'd', order: 0, hasExercise: false },
          { type: 'exercise' as const, title: AUTOEVALUACION.title, description: 'd', order: 1, hasExercise: false }
        ]
      },
      {
        title: 'Atención en el Mostrador',
        order: 1,
        items: [
          {
            type: 'lesson' as const,
            title: 'Atender un reclamo sin perder la calma',
            description: 'd',
            order: 0,
            hasExercise: false
          }
        ]
      }
    ]
  };

  it('da por hecho lo que ya está, aunque el plan lo nombre sin numerar', () => {
    const progreso = buildPlanProgressAnchor(plan, SECCIONES, ITEMS);

    expect(progreso?.items.filter((item) => item.status === 'done').map((item) => item.title)).toEqual(
      expect.arrayContaining([LECCION_ESCRITA.title, AUTOEVALUACION.title])
    );
    expect(progreso?.anchorText).not.toContain('NOT CREATED');
  });

  it('y lo único pendiente es lo que de verdad falta, dentro de la sección que ya existe', () => {
    const progreso = buildPlanProgressAnchor(plan, SECCIONES, ITEMS);

    expect(progreso?.pendingCount).toBe(1);
    expect(progreso?.items.find((item) => item.status === 'missing')?.title).toBe(
      'Atender un reclamo sin perder la calma'
    );
  });
});

describe('las herramientas que crean no duplican lo que ya existe', () => {
  const OPCIONES = { toolCallId: 'llamada', messages: [] };
  const escribirLeccion = vi.fn();

  function herramientas() {
    return buildAgentTools('org', 'usuario', 'curso', [], {
      conversationId: 'conversacion-nueva',
      isBuilding: true,
      locale: 'es',
      escribirLeccion
    }) as Record<string, { execute: (args: unknown, opciones: unknown) => Promise<Record<string, unknown>> }>;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listCourseSections).mockResolvedValue(SECCIONES as never);
    vi.mocked(getCourseContentItems).mockResolvedValue(ITEMS as never);
  });

  it('create_section reusa la sección que el plan nombró sin numerar', async () => {
    const resultado = await herramientas().create_section.execute(
      { title: 'Historia de la Empresa', order: 0, planKey: 's1' },
      OPCIONES
    );

    expect(createCourseSection).not.toHaveBeenCalled();
    expect(resultado).toMatchObject({ id: ID_SECCION_1, reused: true });
    // Y la ata al plan, para que desde acá se reconozca por id y no por título.
    expect(bindPlanItem).toHaveBeenCalledWith(expect.objectContaining({ planKey: 's1', entityId: ID_SECCION_1 }));
  });

  it('create_section sigue creando una sección que de verdad no existe', async () => {
    vi.mocked(createCourseSection).mockResolvedValue({ id: 'sec-nueva', title: 'Seguridad', order: 7 } as never);

    await herramientas().create_section.execute({ title: 'Seguridad e Higiene', order: 7, planKey: 's7' }, OPCIONES);

    expect(createCourseSection).toHaveBeenCalledTimes(1);
  });

  it('create_lesson no crea una segunda ni pisa la que ya está escrita', async () => {
    const resultado = await herramientas().create_lesson.execute(
      {
        sectionId: ID_SECCION_1,
        title: LECCION_ESCRITA.title,
        order: 1,
        locale: 'es',
        planKey: 's1.1',
        content: '<p>Otra versión de la historia</p>'
      },
      OPCIONES
    );

    expect(createLesson).not.toHaveBeenCalled();
    expect(resultado).toMatchObject({ id: ID_LECCION, reused: true, contentWritten: false });
  });

  /** Sin el guardia, el escritor reescribiría la lección que otra conversación ya escribió. */
  it('write_lesson tampoco: ni la crea ni llama al escritor', async () => {
    const resultado = await herramientas().write_lesson.execute(
      {
        sectionId: ID_SECCION_1,
        title: LECCION_ESCRITA.title,
        order: 1,
        locale: 'es',
        planKey: 's1.1',
        brief: 'La historia de la empresa',
        sources: []
      },
      OPCIONES
    );

    expect(createLesson).not.toHaveBeenCalled();
    expect(escribirLeccion).not.toHaveBeenCalled();
    expect(resultado).toMatchObject({ id: ID_LECCION, reused: true, contentWritten: false });
  });

  it('create_exercise no duplica la autoevaluación que la sección ya tiene', async () => {
    const resultado = await herramientas().create_exercise.execute(
      {
        sectionId: ID_SECCION_1,
        title: AUTOEVALUACION.title,
        order: 4,
        planKey: 's1.2',
        // Con su evidencia, como toda pregunta desde que el servidor la busca
        // en las lecciones. Acá ni se llega a mirar: el ejercicio ya existía y
        // la llamada vuelve antes, que es justamente lo que se está fijando.
        questions: [
          {
            question: '¿Algo?',
            questionTypeId: 1,
            order: 0,
            options: [],
            evidence: 'la compañía abrió su primer local en 1978'
          }
        ]
      },
      OPCIONES
    );

    expect(createExercise).not.toHaveBeenCalled();
    expect(resultado).toMatchObject({ id: ID_EJERCICIO, reused: true, questionCount: 7 });
  });
});
