import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ContentType } from '@cio/utils/constants';

/**
 * Un diagrama se puede nombrar, y no se duplica.
 *
 * ── Qué se midió ─────────────────────────────────────────────────────────────
 *
 * Producción, 2026-09-22. El `<svg>` de primer nivel era el ÚNICO bloque de una
 * lección sin `data-block-id`. La orden de trabajo señalaba un valor viejo que
 * vivía adentro del diagrama; el modelo no tenía cómo nombrarlo, probó
 * `edit_lesson_content` con un svg reconstruido de memoria (no coincide) y
 * terminó reemplazando el PÁRRAFO anterior por «párrafo + svg nuevo». El
 * servidor conserva el id del párrafo y deja el svg nuevo al lado; el viejo
 * sigue ahí con el valor viejo, así que el aviso vuelve y el modelo lo repite:
 * 7 veces en una lección y 10 en la otra, 8 y 9 diagramas idénticos seguidos,
 * de 7,9 KB a 29,8 KB, y la ronda muerta contra el tope de 40 pasos.
 *
 * Tres arreglos, y los tres se prueban acá: el id en el propio `<svg>` (medido
 * en el editor y en el sanitizador, ver
 * `apps/dashboard/src/lib/features/course/utils/diagrama-en-el-editor.svelte.test.ts`),
 * la negativa a agregar un diagrama al lado de otro, y la red de seguridad que
 * deduplica al guardar.
 *
 * Curso inventado.
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
  listCourseSources: vi.fn()
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

import { listCourseSources } from '@cio/db/queries/agent/chat-document';
import { updateLesson as updateLessonQuery } from '@cio/db/queries/lesson';
import { listCourseSections } from '@api/services/course/section';
import { getCourseContentItems } from '@cio/db/queries/course/content';
import { getLesson } from '@api/services/lesson/lesson';
import { upsertLessonLanguageService } from '@api/services/lesson-language';
import { buildAgentTools } from '@api/services/agent/chat-tools';
import {
  asignarIdsDeBloque,
  quitarDiagramasDuplicados,
  summarizeLessonBlocks
} from '@api/services/agent/lesson-blocks';
import { buscarEnLecciones } from '@api/services/agent/lesson-search';
import { contarPiezas } from '@api/services/agent/conservacion';

const ID_SECCION = '11111111-1111-4111-8111-111111111111';
const ID_LECCION = 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const SECCIONES = [{ id: ID_SECCION, title: 'Mesa de Ayuda', order: 0, createdAt: '2026-01-01T00:00:00Z' }];

const ITEMS = [
  {
    id: ID_LECCION,
    type: ContentType.Lesson,
    title: 'Cómo se escala un incidente',
    sectionId: ID_SECCION,
    order: 0,
    hasNoteContent: true,
    questionCount: null
  }
];

/** Un diagrama con sus etiquetas, que es lo único legible de un `<svg>`. */
function diagrama(plazo: string, id?: string): string {
  return (
    `<svg${id ? ` data-block-id="${id}"` : ''} viewBox="0 0 240 90" width="240" height="90">` +
    '<text x="10" y="20">P2 Alta</text>' +
    `<text x="10" y="50">Primera respuesta: ${plazo}</text>` +
    '</svg>'
  );
}

/**
 * La lección guardada: un párrafo con id y, pegado, el diagrama con el suyo.
 *
 * El id del diagrama NO se escribe a mano: lo pone el servidor. Con el id
 * pegado en el fixture, los tests de «es un bloque» pasaban igual con el `svg`
 * fuera de `TIPOS_CON_ID` —listar, buscar y reemplazar nunca filtraron por
 * tipo—, o sea que probaban que un svg CON id se maneja, no que el servidor se
 * lo pone. Así, dependen de `asignarIdsDeBloque`.
 */
const LEGADO =
  '<p data-block-id="1ebe2216">El escalamiento depende de la prioridad del incidente.</p>' + diagrama('2 horas');
const CONTENIDO = asignarIdsDeBloque(LEGADO, () => 'd1a9ram0');

const OPCIONES = { toolCallId: 'llamada', messages: [] };

type Herramienta = { execute: (args: unknown, opciones: unknown) => Promise<Record<string, unknown>> };

function herramientas() {
  return buildAgentTools('org', 'usuario', 'curso', [], {
    conversationId: 'conversacion',
    isBuilding: true,
    locale: 'es'
  }) as Record<string, Herramienta>;
}

function guardado(): string {
  return (vi.mocked(upsertLessonLanguageService).mock.calls[0][1] as { content: string }).content;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listCourseSections).mockResolvedValue(SECCIONES as never);
  vi.mocked(getCourseContentItems).mockResolvedValue(ITEMS as never);
  vi.mocked(listCourseSources).mockResolvedValue([] as never);
  vi.mocked(updateLessonQuery).mockResolvedValue(undefined as never);
  vi.mocked(getLesson).mockResolvedValue({
    id: ID_LECCION,
    title: 'Cómo se escala un incidente',
    order: 0,
    lessonLanguages: [{ locale: 'es', content: CONTENIDO }]
  } as never);
});

describe('el diagrama es un bloque como cualquier otro', () => {
  it('un <svg> de primer nivel recibe id al guardar', () => {
    const resultado = asignarIdsDeBloque(`<p>Antes</p>${diagrama('2 horas')}`);

    expect(resultado).toMatch(/<svg[^>]*data-block-id="[^"]+"/);
  });

  it('se lista con una vista previa que dice que es un dibujo', () => {
    const bloques = summarizeLessonBlocks(CONTENIDO);

    expect(bloques.map((b) => b.blockId)).toEqual(['1ebe2216', 'd1a9ram0']);
    // Sin el «[diagram: …]», las etiquetas aplanadas se leen como un párrafo
    // cortado y el modelo le manda un `<p>` al diagrama.
    expect(bloques[1].text).toBe('[diagram: P2 Alta · Primera respuesta: 2 horas]');
  });

  it('reemplazarlo por su id cambia SÓLO el diagrama', async () => {
    const resultado = await herramientas().replace_lesson_block.execute(
      { lessonId: 'S1.L1', blockId: 'd1a9ram0', html: diagrama('1 hora') },
      OPCIONES
    );

    expect(resultado).toMatchObject({ updated: true, blockId: 'd1a9ram0' });

    const contenido = guardado();

    expect(contenido).toContain('Primera respuesta: 1 hora');
    expect(contenido).not.toContain('Primera respuesta: 2 horas');
    // El párrafo de al lado, intacto y con su id.
    expect(contenido).toContain('<p data-block-id="1ebe2216">El escalamiento depende');
    // Y el diagrama conserva el suyo, o la próxima corrección vuelve a no
    // tener cómo nombrarlo.
    expect(contenido).toContain('data-block-id="d1a9ram0"');
    expect((contenido.match(/<svg/g) ?? []).length).toBe(1);
  });

  it('el barrido nombra el diagrama cuando el valor viejo vive adentro', () => {
    const coincidencias = buscarEnLecciones({
      lecciones: [{ id: ID_LECCION, title: 'Cómo se escala un incidente', content: CONTENIDO }],
      texto: '2 horas'
    });

    // Sin esto, la orden de trabajo señalaba el bloque ANTERIOR (el párrafo), y
    // ahí es donde el modelo pegaba el segundo diagrama.
    expect(coincidencias.map((c) => c.blockId)).toEqual(['d1a9ram0']);
  });
});

/**
 * Las lecciones que YA existen: el `<svg>` no tiene id hasta que alguien las
 * escriba.
 *
 * Es el caso medido tal cual el 2026-09-22 y el que el primer arreglo dejaba
 * afuera: el id se estampaba sólo al ESCRIBIR, y el barrido devolvía para un
 * valor dentro del diagrama el id del PÁRRAFO de arriba («still present: block
 * 1ebe2216»). El modelo reemplazaba ese párrafo por «párrafo + svg», el riel lo
 * negaba mandándolo a un id que la lista de bloques no tenía, y quedaba sin una
 * sola jugada legal.
 */
describe('una lección anterior a los ids del diagrama', () => {
  it('el barrido NO señala el párrafo de arriba para un valor que vive en el diagrama', () => {
    const coincidencias = buscarEnLecciones({
      lecciones: [{ id: ID_LECCION, title: 'Cómo se escala un incidente', content: LEGADO }],
      texto: '2 horas'
    });

    expect(coincidencias).toHaveLength(1);
    // Un id equivocado es peor que ninguno: sin id, la orden de trabajo manda a
    // leer la lección, que es lo que le pone nombre al diagrama.
    expect(coincidencias[0].blockId).toBeUndefined();
  });

  it('y un valor en el párrafo sigue señalando el párrafo', () => {
    const coincidencias = buscarEnLecciones({
      lecciones: [{ id: ID_LECCION, title: 'Cómo se escala un incidente', content: LEGADO }],
      texto: 'depende de la prioridad'
    });

    expect(coincidencias.map((c) => c.blockId)).toEqual(['1ebe2216']);
  });

  it('leerla le pone id al diagrama, lo GUARDA y lo lista', async () => {
    vi.mocked(getLesson).mockResolvedValue({
      id: ID_LECCION,
      title: 'Cómo se escala un incidente',
      order: 0,
      lessonLanguages: [{ locale: 'es', content: LEGADO }]
    } as never);

    const resultado = await herramientas().get_lesson_content.execute({ lessonId: 'S1.L1' }, OPCIONES);
    const bloques = resultado.blocks as Array<{ blockId: string; text: string }>;

    expect(bloques).toHaveLength(2);
    expect(bloques[1].text).toContain('[diagram:');

    // Guardado, no sólo devuelto: `replace_lesson_block` empalma sobre lo que
    // está en la base, y un id que no está ahí no lo encontraría.
    expect(upsertLessonLanguageService).toHaveBeenCalledTimes(1);
    expect(guardado()).toContain(`data-block-id="${bloques[1].blockId}"`);
    expect(String(resultado.content)).toContain(`data-block-id="${bloques[1].blockId}"`);
  });

  /**
   * Capacidad nueva, instrucción vieja: la descripción de `edit_lesson_content`
   * mandaba a «redo just a diagram» por ahí, que es la jugada medida (un
   * `<svg>` reconstruido de memoria que no coincide con nada). Las dos
   * herramientas no pueden contradecirse sobre el camino de un diagrama.
   */
  it('ninguna herramienta manda a rehacer un diagrama por find-and-replace', () => {
    const tools = herramientas() as unknown as Record<string, { description: string }>;

    expect(tools.edit_lesson_content.description).not.toMatch(/redo just a diagram/i);
    expect(tools.edit_lesson_content.description).toContain('A DIAGRAM has its own blockId');
    expect(tools.replace_lesson_block.description).not.toContain('fall back to edit_lesson_content');
  });

  it('y una lección que ya tiene todos sus ids se lee sin escribir nada', async () => {
    await herramientas().get_lesson_content.execute({ lessonId: 'S1.L1' }, OPCIONES);

    expect(upsertLessonLanguageService).not.toHaveBeenCalled();
  });
});

describe('nadie agrega un diagrama al lado de otro', () => {
  it('reemplazar el párrafo previo por «párrafo + svg» se rechaza nombrando el diagrama', async () => {
    const resultado = await herramientas().replace_lesson_block.execute(
      {
        lessonId: 'S1.L1',
        blockId: '1ebe2216',
        html: `<p>El escalamiento depende de la prioridad del incidente.</p>${diagrama('1 hora')}`
      },
      OPCIONES
    );

    expect(upsertLessonLanguageService).not.toHaveBeenCalled();
    expect(resultado.ok).toBe(false);

    const aviso = String(resultado.error);

    expect(aviso).toContain('d1a9ram0');
    expect(aviso).toContain('replace_lesson_block');
  });

  it('pero reemplazar el diagrama POR un diagrama es exactamente lo que se quiere', async () => {
    const resultado = await herramientas().replace_lesson_block.execute(
      { lessonId: 'S1.L1', blockId: 'd1a9ram0', html: diagrama('1 hora') },
      OPCIONES
    );

    expect(resultado).toMatchObject({ updated: true });
  });

  it('y un párrafo que no está seguido de un diagrama puede traer uno', async () => {
    vi.mocked(getLesson).mockResolvedValue({
      id: ID_LECCION,
      title: 'Cómo se escala un incidente',
      order: 0,
      lessonLanguages: [{ locale: 'es', content: '<p data-block-id="1ebe2216">El escalamiento por prioridad.</p>' }]
    } as never);

    const resultado = await herramientas().replace_lesson_block.execute(
      {
        lessonId: 'S1.L1',
        blockId: '1ebe2216',
        html: `<p>El escalamiento por prioridad.</p>${diagrama('1 hora')}`
      },
      OPCIONES
    );

    expect(resultado).toMatchObject({ updated: true });
  });

  /**
   * Un bloque que YA tiene un diagrama adentro, seguido de otro diagrama.
   *
   * Preguntar sólo «¿el reemplazo trae un svg?» negaba volver a mandar el mismo
   * bloque con su svg intacto («adds another one next to it», y no agregó
   * nada); sacarle el svg lo negaba la guardia de conservación («drops 1
   * diagram»). Las dos guardias negándose entre sí. Lo que se niega es traer
   * MÁS diagramas de los que el bloque tenía.
   */
  describe('un bloque con un diagrama adentro', () => {
    const conDiagramaAdentro = (plazo: string, extra = '') =>
      `<div data-block-id="c0nt3n1d"><p>Plazos del P2: ${plazo}.</p>${diagrama(plazo)}${extra}</div>`;

    beforeEach(() => {
      vi.mocked(getLesson).mockResolvedValue({
        id: ID_LECCION,
        title: 'Cómo se escala un incidente',
        order: 0,
        lessonLanguages: [{ locale: 'es', content: `${conDiagramaAdentro('2 horas')}${diagrama('8 horas', 'd1a9ram0')}` }]
      } as never);
    });

    it('se puede volver a guardar con su diagrama intacto', async () => {
      const resultado = await herramientas().replace_lesson_block.execute(
        { lessonId: 'S1.L1', blockId: 'c0nt3n1d', html: conDiagramaAdentro('1 hora') },
        OPCIONES
      );

      expect(resultado).toMatchObject({ updated: true });
      expect(guardado()).toContain('Plazos del P2: 1 hora.');
    });

    it('pero no con un diagrama de más', async () => {
      const resultado = await herramientas().replace_lesson_block.execute(
        { lessonId: 'S1.L1', blockId: 'c0nt3n1d', html: conDiagramaAdentro('1 hora', diagrama('1 hora')) },
        OPCIONES
      );

      expect(resultado.ok).toBe(false);
      expect(String(resultado.error)).toContain('d1a9ram0');
      expect(upsertLessonLanguageService).not.toHaveBeenCalled();
    });
  });
});

describe('la red de seguridad: diagramas duplicados', () => {
  it('de ocho copias idénticas seguidas queda una', () => {
    // El caso medido, tal cual: ocho veces el MISMO dibujo, uno atrás del otro.
    const ocho = Array.from({ length: 8 }, () => diagrama('2 horas')).join('');
    const resultado = quitarDiagramasDuplicados(`<p>Antes</p>${ocho}<p>Después</p>`);

    expect((resultado.match(/<svg/g) ?? []).length).toBe(1);
    expect(resultado).toContain('<p>Antes</p>');
    expect(resultado).toContain('<p>Después</p>');
  });

  /** Un diagrama de verdad tiene diez etiquetas: cambiar UN valor es el 90 %. */
  function escalamiento(plazoP2: string): string {
    const etiquetas = [
      'Incidente',
      'P1 Crítica',
      'Primera respuesta: 15 minutos',
      'Resolución: 4 horas',
      'P2 Alta',
      `Primera respuesta: ${plazoP2}`,
      'Resolución: 8 horas',
      'P3 Media',
      'Primera respuesta: 8 horas',
      'Cierre con conformidad'
    ];

    return `<svg viewBox="0 0 400 400">${etiquetas
      .map((etiqueta, i) => `<text x="10" y="${20 + i * 30}">${etiqueta}</text>`)
      .join('')}</svg>`;
  }

  it('la copia corregida se queda con el lugar, y la vieja se va', () => {
    const resultado = quitarDiagramasDuplicados(`${escalamiento('2 horas')}${escalamiento('1 hora')}`);

    expect((resultado.match(/<svg/g) ?? []).length).toBe(1);
    // La última es la NUEVA: quedarse con la primera revertiría la corrección
    // que el modelo acababa de hacer.
    expect(resultado).toContain('Primera respuesta: 1 hora');
    expect(resultado).not.toContain('Primera respuesta: 2 horas');
  });

  it('dos diagramas que comparten la mitad de sus etiquetas quedan los dos', () => {
    // La mitad iguales: con un umbral del 50 % esto borraría un dibujo distinto,
    // que es contenido. Por eso el umbral es 90 %.
    const otro = escalamiento('2 horas')
      .replace('P3 Media', 'P4 Baja')
      .replace('Incidente', 'Reclamo comercial')
      .replace('Resolución: 4 horas', 'Resolución: 24 horas')
      .replace('Resolución: 8 horas', 'Resolución: 48 horas')
      .replace('Cierre con conformidad', 'Cierre automático');
    const resultado = quitarDiagramasDuplicados(`${escalamiento('2 horas')}${otro}`);

    expect((resultado.match(/<svg/g) ?? []).length).toBe(2);
  });

  it('dos copias separadas por un párrafo no se tocan: no son una tira', () => {
    const resultado = quitarDiagramasDuplicados(`${diagrama('2 horas')}<p>Un texto.</p>${diagrama('2 horas')}`);

    expect((resultado.match(/<svg/g) ?? []).length).toBe(2);
  });

  it('y dos dibujos sin etiquetas quedan los dos: no hay con qué compararlos', () => {
    const mudo = '<svg viewBox="0 0 10 10"><rect x="1" y="1" width="5" height="5" /></svg>';
    const resultado = quitarDiagramasDuplicados(`${mudo}${mudo}`);

    expect((resultado.match(/<svg/g) ?? []).length).toBe(2);
  });

  it('y una lección escrita entera con copias pegadas también', async () => {
    // La red corre en los MISMOS puntos donde se estampan los ids, así que el
    // cuerpo entero que escribe el asistente pasa por ella igual que un empalme.
    await herramientas().update_lesson_content.execute(
      {
        lessonId: 'S1.L1',
        content:
          '<p>El escalamiento depende de la prioridad del incidente.</p>' +
          `${diagrama('2 horas')}${diagrama('2 horas')}`
      },
      OPCIONES
    );

    expect((guardado().match(/<svg/g) ?? []).length).toBe(1);
  });

  /**
   * Contar no es eliminar: el log de la red de seguridad sale sólo cuando algo
   * se guarda sin las copias.
   *
   * La guardia de conservación deduplica los dos lados para comparar, dos veces
   * por cada edición. Con el log adentro, una lección vieja con ocho copias
   * dejaba dos «7 eliminados» falsos por cada edición de OTRO bloque, y el log
   * dejaba de decir cuándo actuó la red.
   */
  it('contar piezas no dice que eliminó nada', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const ocho = Array.from({ length: 8 }, () => diagrama('2 horas')).join('');

    expect(contarPiezas(`<p>Antes</p>${ocho}`).diagramas).toBe(1);
    expect(info).not.toHaveBeenCalled();

    info.mockRestore();
  });

  it('una lección que llega con copias pegadas se guarda con una sola', async () => {
    await herramientas().replace_lesson_block.execute(
      {
        lessonId: 'S1.L1',
        blockId: 'd1a9ram0',
        html: `${diagrama('1 hora')}${diagrama('1 hora')}`
      },
      OPCIONES
    );

    expect((guardado().match(/<svg/g) ?? []).length).toBe(1);
  });
});
