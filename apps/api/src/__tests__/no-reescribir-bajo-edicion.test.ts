import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ContentType } from '@cio/utils/constants';

/**
 * Bajo una orden de EDICIÓN, la lección no se reescribe entera.
 *
 * ── Qué se midió ─────────────────────────────────────────────────────────────
 *
 * 2026-09-22, actualizar dos lecciones con una circular nueva. El servidor
 * devolvió un aviso que el modelo no podía atender por bloques (una etiqueta de
 * un diagrama, ver `grounding-tokens.ts`), y a la segunda vuelta hizo lo único
 * que le quedaba para cerrarlo: `update_lesson_content` con la lección entera.
 * En la primera lección desaparecieron los tres «Caso 1 / Caso 2 / Caso 3» que
 * ya estaban marcados como ejemplo —3 `data-ejemplo` → 0— reemplazados por un
 * diagrama que nadie había pedido.
 *
 * El prompt ya decía que no se reescribiera. Un aviso que no se puede
 * satisfacer gana contra una instrucción, así que acá se contesta que no.
 *
 * Lo que se fija:
 *   1. con `edit` pendiente, `update_lesson_content` no guarda NADA y el aviso
 *      dice cuál es el camino;
 *   2. `replace_lesson_block` sobre la misma lección sí guarda: lo que se niega
 *      es la reescritura, no la edición;
 *   3. con `rewrite` el escritor sigue habilitado y la mano del constructor no;
 *   4. una lección que no está en la orden no se toca.
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

vi.mock('@api/services/lesson-language', () => ({
  upsertLessonLanguageService: vi.fn()
}));

vi.mock('@cio/db/queries/lesson', async (original) => ({
  ...(await original<typeof import('@cio/db/queries/lesson')>()),
  updateLesson: vi.fn()
}));

vi.mock('@cio/db/queries/agent/chat-document', async (original) => ({
  ...(await original<typeof import('@cio/db/queries/agent/chat-document')>()),
  listCourseSources: vi.fn().mockResolvedValue([])
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

import { updateLesson as updateLessonQuery } from '@cio/db/queries/lesson';
import { listCourseSections } from '@api/services/course/section';
import { getCourseContentItems } from '@cio/db/queries/course/content';
import { createLesson, getLesson } from '@api/services/lesson/lesson';
import { resolvePlanBinding } from '@cio/db/queries/agent';
import { upsertLessonLanguageService } from '@api/services/lesson-language';
import { buildAgentTools } from '@api/services/agent/chat-tools';

const ID = {
  seccion: '11111111-1111-4111-8111-111111111111',
  quienAtiende: 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  comoSeCierra: 'aaaaaaa2-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  leccionNueva: 'aaaaaaa3-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
};

const SECCIONES = [{ id: ID.seccion, title: 'Mesa de Ayuda', order: 0, createdAt: '2026-01-02T00:00:00Z' }];

const ITEMS = [
  {
    id: ID.quienAtiende,
    type: ContentType.Lesson,
    title: 'Quién atiende cada reclamo',
    sectionId: ID.seccion,
    order: 0,
    hasNoteContent: true,
    questionCount: null
  },
  {
    id: ID.comoSeCierra,
    type: ContentType.Lesson,
    title: 'Cómo se cierra un reclamo',
    sectionId: ID.seccion,
    order: 1,
    hasNoteContent: true,
    questionCount: null
  }
];

/** La lección con sus tres ejemplos ya declarados: lo que una reescritura se lleva puesto. */
const CON_EJEMPLOS =
  '<p data-block-id="b7">El reclamo se toma por el interno 4400.</p>' +
  '<p data-block-id="b8" data-ejemplo="caso inventado">Caso 1: el cliente llama por un faltante.</p>' +
  '<p data-block-id="b9" data-ejemplo="caso inventado">Caso 2: el cliente escribe por una rotura.</p>';

const OPCIONES = { toolCallId: 'llamada', messages: [] };

type Herramienta = { execute: (args: unknown, opciones: unknown) => Promise<Record<string, unknown>> };

const escribirLeccion = vi.fn();

function herramientas(accionPorLeccion?: Map<string, 'edit' | 'rewrite'>) {
  return buildAgentTools('org', 'usuario', 'curso', [], {
    conversationId: 'conversacion',
    isBuilding: true,
    locale: 'es',
    escribirLeccion,
    ...(accionPorLeccion ? { accionPorLeccion } : {})
  }) as Record<string, Herramienta>;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listCourseSections).mockResolvedValue(SECCIONES as never);
  vi.mocked(getCourseContentItems).mockResolvedValue(ITEMS as never);
  vi.mocked(getLesson).mockImplementation(
    async (id: string) =>
      ({
        id,
        title: ITEMS.find((item) => item.id === id)?.title ?? 'Lección',
        order: 0,
        lessonLanguages: [{ locale: 'es', content: CON_EJEMPLOS }]
      }) as never
  );
  // El informe se guarda con `.catch(...)`: sin promesa acá, el guardado del
  // cuerpo se caería por el informe, que es justo lo que no puede pasar.
  vi.mocked(updateLessonQuery).mockResolvedValue(undefined as never);
});

describe('una lección con orden de EDICIÓN', () => {
  const bajoEdicion = () => new Map<string, 'edit' | 'rewrite'>([[ID.quienAtiende, 'edit']]);

  it('update_lesson_content no guarda nada y dice cuál es el camino', async () => {
    const resultado = await herramientas(bajoEdicion()).update_lesson_content.execute(
      { lessonId: 'S1.L1', content: '<p>Una lección nueva, escrita de cero.</p>' },
      OPCIONES
    );

    expect(upsertLessonLanguageService).not.toHaveBeenCalled();
    expect(resultado.ok).toBe(false);
    expect(String(resultado.error)).toContain('EDIT order');
    expect(String(resultado.error)).toContain('replace_lesson_block');
  });

  it('write_lesson con lessonId tampoco: no se paga la llamada al escritor', async () => {
    const resultado = await herramientas(bajoEdicion()).write_lesson.execute(
      { lessonId: 'S1.L1', brief: 'Actualizá el contacto.', sources: [] },
      OPCIONES
    );

    expect(escribirLeccion).not.toHaveBeenCalled();
    expect(upsertLessonLanguageService).not.toHaveBeenCalled();
    expect(resultado.ok).toBe(false);
  });

  it('create_lesson con contenido sobre la misma lección tampoco la pisa', async () => {
    // Llega acá por la atadura del plan: `create_lesson` reusa la lección que
    // ese ítem ya construyó, y ése es el camino por el que una reescritura se
    // colaría sin nombrarse reescritura.
    vi.mocked(resolvePlanBinding).mockResolvedValue({ entityId: ID.quienAtiende } as never);

    const resultado = await herramientas(bajoEdicion()).create_lesson.execute(
      {
        sectionId: 'S1',
        title: 'Quién atiende cada reclamo',
        order: 0,
        planKey: 's1.1',
        content: '<p>Una lección nueva, escrita de cero.</p>'
      },
      OPCIONES
    );

    expect(createLesson).not.toHaveBeenCalled();
    expect(upsertLessonLanguageService).not.toHaveBeenCalled();
    expect(resultado.ok).toBe(false);
  });

  /** Lo que se niega es la reescritura. La edición es justamente lo que se pidió. */
  it('replace_lesson_block sobre esa misma lección sí guarda', async () => {
    const resultado = await herramientas(bajoEdicion()).replace_lesson_block.execute(
      { lessonId: 'S1.L1', blockId: 'b7', html: '<p>El reclamo se toma por WhatsApp 11 5555-0101.</p>' },
      OPCIONES
    );

    expect(resultado).toMatchObject({ updated: true, blockId: 'b7' });

    const guardado = vi.mocked(upsertLessonLanguageService).mock.calls[0][1] as { content: string };

    expect(guardado.content).toContain('WhatsApp 11 5555-0101');
    // Y los ejemplos declarados siguen ahí, que es lo que la reescritura borró.
    expect((guardado.content.match(/data-ejemplo/g) ?? []).length).toBe(2);
  });

  it('una lección que no está en la orden se reescribe como siempre', async () => {
    const resultado = await herramientas(bajoEdicion()).update_lesson_content.execute(
      { lessonId: 'S1.L2', content: '<p>El reclamo se cierra con la conformidad del cliente.</p>' },
      OPCIONES
    );

    expect(resultado).toMatchObject({ lessonId: ID.comoSeCierra, updated: true });
    expect(upsertLessonLanguageService).toHaveBeenCalledWith(ID.comoSeCierra, expect.anything());
  });

  it('y sin orden de trabajo nada de esto se activa', async () => {
    const resultado = await herramientas().update_lesson_content.execute(
      { lessonId: 'S1.L1', content: '<p>Una lección nueva, escrita de cero.</p>' },
      OPCIONES
    );

    expect(resultado).toMatchObject({ lessonId: ID.quienAtiende, updated: true });
  });
});

describe('una lección con orden de REESCRITURA', () => {
  const bajoReescritura = () => new Map<string, 'edit' | 'rewrite'>([[ID.quienAtiende, 'rewrite']]);

  it('write_lesson sigue habilitado: el escritor es el camino', async () => {
    escribirLeccion.mockResolvedValue({
      html: '<p>El reclamo se toma por WhatsApp 11 5555-0101.</p>',
      material: [],
      fuentesUsadas: [],
      fuentesNoEncontradas: [],
      recortadas: []
    });

    const resultado = await herramientas(bajoReescritura()).write_lesson.execute(
      { lessonId: 'S1.L1', brief: 'Reescribila con la circular nueva.', sources: [] },
      OPCIONES
    );

    expect(escribirLeccion).toHaveBeenCalledTimes(1);
    expect(resultado).toMatchObject({ contentWritten: true });
  });

  /**
   * Un cuerpo tipeado por el constructor no se contrasta contra nada: durante
   * una construcción él no leyó ninguna fuente. Reescribir desde el material es
   * exactamente lo que el escritor hace y esto no.
   */
  it('update_lesson_content no, porque saltea el contraste contra las fuentes', async () => {
    const resultado = await herramientas(bajoReescritura()).update_lesson_content.execute(
      { lessonId: 'S1.L1', content: '<p>Una lección nueva, escrita de cero.</p>' },
      OPCIONES
    );

    expect(upsertLessonLanguageService).not.toHaveBeenCalled();
    expect(resultado.ok).toBe(false);
    expect(String(resultado.error)).toContain('REWRITE order');
    expect(String(resultado.error)).toContain('write_lesson');
  });
});

describe('crear una lección nueva no queda atrapado en el riel', () => {
  it('create_lesson con contenido, sobre una lección que no existía, escribe', async () => {
    vi.mocked(createLesson).mockResolvedValue({
      id: ID.leccionNueva,
      title: 'Faltantes y roturas',
      order: 2
    } as never);

    const resultado = await herramientas(new Map([[ID.quienAtiende, 'edit']])).create_lesson.execute(
      { sectionId: 'S1', title: 'Faltantes y roturas', order: 2, content: '<p>Qué se hace con un faltante.</p>' },
      OPCIONES
    );

    expect(resultado).toMatchObject({ id: ID.leccionNueva, contentWritten: true });
  });
});
