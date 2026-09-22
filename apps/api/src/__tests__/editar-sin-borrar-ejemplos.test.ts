import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ContentType } from '@cio/utils/constants';

/**
 * Una edición por bloques no se lleva puestos los ejemplos marcados, ni guarda
 * HTML inválido.
 *
 * ── Qué se midió ─────────────────────────────────────────────────────────────
 *
 * 2026-09-22, actualizar dos lecciones con una circular. El bloque era un `<ul>`
 * con tres `<li data-ejemplo>` («Caso 1/2/3»); la orden de trabajo decía
 * «todavía está» por un número que vivía dentro del Caso 2, y el modelo
 * reemplazó el `<ul>` ENTERO por un `<p>`. En la otra lección, un `<ul>` con
 * cuatro casos marcados terminó siendo un `<svg>`: 8 marcas → 1. Y en un tercer
 * bloque aceptó un `<li>` suelto como reemplazo de un `<ul>`, o sea HTML
 * inválido guardado sin un solo error.
 *
 * Lo que se fija:
 *   1. un reemplazo con MENOS marcas no guarda nada, y el aviso nombra cada
 *      ejemplo que se estaba por perder;
 *   2. el mismo `<ul>` con el dato cambiado adentro y las marcas intactas sí
 *      guarda;
 *   3. el reemplazo vacío (borrado explícito) sigue permitido;
 *   4. un `<li>` suelto se rechaza;
 *   5. `edit_lesson_content` sigue la misma regla sobre la lección entera.
 *
 * Curso inventado, de una mesa de ayuda que no existe.
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

vi.mock('@api/services/agent/chat-context', async (original) => ({
  ...(await original<typeof import('@api/services/agent/chat-context')>()),
  verifySectionBelongsToCourse: vi.fn(),
  verifyLessonBelongsToCourse: vi.fn(),
  verifyExerciseBelongsToCourse: vi.fn()
}));

import { updateLesson as updateLessonQuery } from '@cio/db/queries/lesson';
import { listCourseSections } from '@api/services/course/section';
import { getCourseContentItems } from '@cio/db/queries/course/content';
import { getLesson } from '@api/services/lesson/lesson';
import { upsertLessonLanguageService } from '@api/services/lesson-language';
import { buildAgentTools } from '@api/services/agent/chat-tools';

const ID = {
  seccion: '11111111-1111-4111-8111-111111111111',
  leccion: 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
};

const SECCIONES = [{ id: ID.seccion, title: 'Mesa de Ayuda', order: 0, createdAt: '2026-01-02T00:00:00Z' }];

const ITEMS = [
  {
    id: ID.leccion,
    type: ContentType.Lesson,
    title: 'Quién atiende cada reclamo',
    sectionId: ID.seccion,
    order: 0,
    hasNoteContent: true,
    questionCount: null
  }
];

/** El bloque real que se perdió: un listado cuyos tres ítems son ejemplos declarados. */
const LISTA_DE_CASOS =
  '<ul data-block-id="b7">' +
  '<li data-ejemplo="caso inventado 1">Caso 1: faltante, se llama al interno 4400.</li>' +
  '<li data-ejemplo="caso inventado 2">Caso 2: rotura, se avisa al interno 4400.</li>' +
  '<li data-ejemplo="caso inventado 3">Caso 3: demora, se escala al interno 4400.</li>' +
  '</ul>';

const CONTENIDO = `<p data-block-id="b1">El reclamo se toma por el interno 4400.</p>${LISTA_DE_CASOS}`;

const OPCIONES = { toolCallId: 'llamada', messages: [] };

type Herramienta = { execute: (args: unknown, opciones: unknown) => Promise<Record<string, unknown>> };

function herramientas() {
  return buildAgentTools('org', 'usuario', 'curso', [], {
    conversationId: 'conversacion',
    isBuilding: true,
    locale: 'es'
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
        title: 'Quién atiende cada reclamo',
        order: 0,
        lessonLanguages: [{ locale: 'es', content: CONTENIDO }]
      }) as never
  );
  vi.mocked(updateLessonQuery).mockResolvedValue(undefined as never);
});

describe('replace_lesson_block y los ejemplos marcados', () => {
  it('reemplazar un <ul> de tres ejemplos por un <p> no guarda nada', async () => {
    const resultado = await herramientas().replace_lesson_block.execute(
      { lessonId: 'S1.L1', blockId: 'b7', html: '<p>Error 2: el reclamo entra por WhatsApp 11 5555-0101.</p>' },
      OPCIONES
    );

    expect(upsertLessonLanguageService).not.toHaveBeenCalled();
    expect(resultado.ok).toBe(false);

    const aviso = String(resultado.error);

    // El aviso NOMBRA lo que se estaba por perder: sin eso, «no puedo» es un
    // muro y el modelo prueba otra cosa peor.
    expect(aviso).toContain('3 marked example');
    expect(aviso).toContain('caso inventado 1');
    expect(aviso).toContain('caso inventado 2');
    expect(aviso).toContain('caso inventado 3');
    expect(aviso).toContain('data-ejemplo');
  });

  it('el mismo <ul> con el dato cambiado adentro y las tres marcas sí guarda', async () => {
    const resultado = await herramientas().replace_lesson_block.execute(
      {
        lessonId: 'S1.L1',
        blockId: 'b7',
        html:
          '<ul>' +
          '<li data-ejemplo="caso inventado 1">Caso 1: faltante, se escribe al 11 5555-0101.</li>' +
          '<li data-ejemplo="caso inventado 2">Caso 2: rotura, se avisa al 11 5555-0101.</li>' +
          '<li data-ejemplo="caso inventado 3">Caso 3: demora, se escala al 11 5555-0101.</li>' +
          '</ul>'
      },
      OPCIONES
    );

    expect(resultado).toMatchObject({ updated: true, blockId: 'b7' });

    const guardado = vi.mocked(upsertLessonLanguageService).mock.calls[0][1] as { content: string };

    expect((guardado.content.match(/data-ejemplo/g) ?? []).length).toBe(3);
    expect(guardado.content).toContain('11 5555-0101');
  });

  /** Borrar un bloque es una decisión, no un accidente: el riel no la toca. */
  it('el reemplazo vacío sigue borrando el bloque', async () => {
    const resultado = await herramientas().replace_lesson_block.execute(
      { lessonId: 'S1.L1', blockId: 'b7', html: '' },
      OPCIONES
    );

    expect(resultado).toMatchObject({ deleted: true, updated: true });

    const guardado = vi.mocked(upsertLessonLanguageService).mock.calls[0][1] as { content: string };

    expect(guardado.content).not.toContain('data-ejemplo');
  });

  it('un <li> suelto como reemplazo de un <ul> se rechaza', async () => {
    const resultado = await herramientas().replace_lesson_block.execute(
      { lessonId: 'S1.L1', blockId: 'b1', html: '<li data-ejemplo="uno">Caso único.</li>' },
      OPCIONES
    );

    expect(upsertLessonLanguageService).not.toHaveBeenCalled();
    expect(resultado.ok).toBe(false);
    expect(String(resultado.error)).toContain('standalone block');
  });
});

describe('edit_lesson_content y los ejemplos marcados', () => {
  it('una edición que se come el listado entero no guarda nada', async () => {
    const resultado = await herramientas().edit_lesson_content.execute(
      { lessonId: 'S1.L1', oldString: LISTA_DE_CASOS, newString: '<p>Los casos se ven en el anexo.</p>' },
      OPCIONES
    );

    expect(upsertLessonLanguageService).not.toHaveBeenCalled();
    expect(resultado.ok).toBe(false);
    expect(String(resultado.error)).toContain('3 marked example');
  });

  it('cambiar el dato dentro de un ejemplo, dejando la marca, sí guarda', async () => {
    const resultado = await herramientas().edit_lesson_content.execute(
      {
        lessonId: 'S1.L1',
        oldString: 'Caso 2: rotura, se avisa al interno 4400.',
        newString: 'Caso 2: rotura, se avisa al 11 5555-0101.'
      },
      OPCIONES
    );

    expect(resultado).toMatchObject({ updated: true });

    const guardado = vi.mocked(upsertLessonLanguageService).mock.calls[0][1] as { content: string };

    expect((guardado.content.match(/data-ejemplo/g) ?? []).length).toBe(3);
  });

  it('borrar un fragmento con newString vacío sigue permitido', async () => {
    const resultado = await herramientas().edit_lesson_content.execute(
      { lessonId: 'S1.L1', oldString: LISTA_DE_CASOS, newString: '' },
      OPCIONES
    );

    expect(resultado).toMatchObject({ updated: true });
  });
});
