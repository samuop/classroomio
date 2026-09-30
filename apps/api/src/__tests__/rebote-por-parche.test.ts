import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ContentType } from '@cio/utils/constants';

/**
 * El rebote por PARCHE: los datos que no aparecen en ningún lado vuelven al
 * escritor como una pregunta por bloque, y el servidor sólo pone la marca.
 *
 * ── Lo que se midió (producción, 2026-09-29) ─────────────────────────────────
 *
 * El rebote le devolvía al escritor la lección entera con los datos que el
 * chequeo no encontraba, y le daba tres salidas: marcar como ejemplo, marcar
 * como afirmación sin fuente, o «sacarlo o reemplazarlo por lo que dice el
 * material». Las teclas, las pestañas y las palabras de la docente no entraban
 * en las dos primeras, así que la segunda versión las borró. Y cada rebote era
 * una llamada de escritor entera más otro juez: el 54 % del tiempo de escribir.
 *
 * Acá se fija, con el mismo contexto que arma la app —la conversación leída de
 * la base, las fuentes del curso, el marcador que viene con el escritor—:
 *
 *   - al marcador sólo le llega lo que no está en NINGÚN lado (ni en otra
 *     fuente del curso ni en el pedido de la docente);
 *   - sus decisiones se aplican como atributos y el texto queda idéntico;
 *   - no se vuelve a llamar ni al escritor ni al juez;
 *   - lo que queda va al informe y no vuelve al constructor como orden.
 *
 * Curso, fuentes y pedido inventados.
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
  resolvePlanBinding: vi.fn().mockResolvedValue(null),
  readPlanRegistry: vi.fn().mockResolvedValue([]),
  getChatConversation: vi.fn()
}));

vi.mock('@api/services/agent/chat-context', async (original) => ({
  ...(await original<typeof import('@api/services/agent/chat-context')>()),
  verifySectionBelongsToCourse: vi.fn(),
  verifyLessonBelongsToCourse: vi.fn(),
  verifyExerciseBelongsToCourse: vi.fn()
}));

import { getChatConversation } from '@cio/db/queries/agent';
import { listCourseSources } from '@cio/db/queries/agent/chat-document';
import { updateLesson as updateLessonQuery } from '@cio/db/queries/lesson';
import { listCourseSections } from '@api/services/course/section';
import { getCourseContentItems } from '@cio/db/queries/course/content';
import { getLesson } from '@api/services/lesson/lesson';
import { upsertLessonLanguageService } from '@api/services/lesson-language';
import { buildAgentTools } from '@api/services/agent/chat-tools';
import { textoParaTokens } from '@api/services/agent/grounding-tokens';
import type { EscritorDeLecciones } from '@api/services/agent/lesson-writer';
import { ROTULO_MANTENER, type EntradaDelParche } from '@api/services/agent/marcas-del-rebote';

const ID_SECCION = '11111111-1111-4111-8111-111111111111';
const ID_LECCION = 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ID_CONVERSACION = '00000000-0000-4000-8000-00000000f001';

const SECCIONES = [{ id: ID_SECCION, title: 'Primeros pasos', order: 0, createdAt: '2026-01-01T00:00:00Z' }];

const ITEMS = [
  {
    id: ID_LECCION,
    type: ContentType.Lesson,
    title: 'Moverse por la hoja',
    sectionId: ID_SECCION,
    order: 0,
    hasNoteContent: false,
    questionCount: null
  }
];

/** La fuente que el plan le asignó a la lección. No dice nada de la cinta. */
const FUENTE_DE_LA_LECCION = {
  id: 'fuente-1',
  fileName: 'guia-de-filas.pdf',
  text: 'La hoja de cálculo se organiza en filas y columnas. Cada celda se nombra por su columna y su fila, como B3.'
};

/** Otra fuente del CURSO, que la lección no tuvo asignada: ahí está «Insertar». */
const OTRA_FUENTE_DEL_CURSO = {
  id: 'fuente-2',
  fileName: 'guia-de-la-cinta.pdf',
  text: 'Desde la pestaña Insertar se agregan tablas y gráficos a la hoja.'
};

/** Lo que la docente escribió en su pedido, como lo guarda la conversación. */
const CONVERSACION = {
  id: ID_CONVERSACION,
  messages: [
    {
      id: 'mensaje-1',
      role: 'user',
      parts: [{ type: 'text', text: 'Público destinatario: vendedores de un comercio abierto 24 hs.' }]
    },
    {
      id: 'mensaje-2',
      role: 'assistant',
      parts: [{ type: 'text', text: 'Armo un plan de tres secciones.' }]
    }
  ]
};

/**
 * La primera versión del escritor, con la forma de los casos medidos: el
 * contexto de la docente, una pestaña que está en otra fuente, un ejemplo
 * inventado sin marcar, una tecla cierta y un proveedor inventado.
 */
const PRIMERA_VERSION =
  '<h3>Moverse por la hoja</h3>' +
  '<p>En un comercio abierto las 24 horas, la planilla se completa en cada turno.</p>' +
  '<p>La hoja se organiza en filas y columnas, y los gráficos se agregan desde la pestaña Insertar de la cinta.</p>' +
  '<p>Un caso: el turno noche carga la factura 4471 por 180.000 pesos.</p>' +
  '<ul><li>Cada celda se nombra por su columna y su fila, como B3.</li><li>La tecla Tab pasa a la celda de la derecha.</li></ul>' +
  '<p>El local compra siempre a la distribuidora Arlux.</p>';

const OPCIONES = { toolCallId: 'llamada', messages: [] };

type Herramienta = { execute: (args: unknown, opciones: unknown) => Promise<Record<string, unknown>> };

function leccionEscrita(html: string) {
  return {
    html,
    material: [{ fileName: FUENTE_DE_LA_LECCION.fileName, text: FUENTE_DE_LA_LECCION.text }],
    fuentesUsadas: [FUENTE_DE_LA_LECCION.fileName],
    fuentesNoEncontradas: [],
    recortadas: []
  };
}

/**
 * El marcador que decide como lo haría el escritor: el ejemplo es ejemplo, la
 * tecla es conocimiento general, el proveedor es una afirmación sin fuente.
 */
function marcadorQueDecide() {
  return vi.fn(async (entrada: EntradaDelParche) =>
    entrada.bloques.flatMap((bloque) =>
      bloque.tokens.map((token) => ({
        blockId: bloque.blockId,
        token,
        accion: token === 'Tab' ? ('mantener' as const) : token === 'Arlux' ? ('sin-fuente' as const) : ('ejemplo' as const),
        motivo:
          token === 'Tab'
            ? 'Tab es la tecla estándar para pasar a la celda de la derecha'
            : token === 'Arlux'
              ? 'el material no dice a qué proveedor le compra el local'
              : 'un caso inventado para mostrar la carga de una factura'
      }))
    )
  );
}

/** El escritor como lo arma la app: una función con su marcador colgado. */
function escritorCon(html: string, marcarTokens?: ReturnType<typeof marcadorQueDecide>) {
  const escribir = vi.fn().mockResolvedValue(leccionEscrita(html));

  return Object.assign(escribir, marcarTokens ? { marcarTokens } : {}) as unknown as EscritorDeLecciones & {
    mock: typeof escribir.mock;
  };
}

function herramientas(escribirLeccion: EscritorDeLecciones, verificarFundamento = juezSinAvisos()) {
  return buildAgentTools('org', 'usuario', 'curso', [], {
    conversationId: ID_CONVERSACION,
    isBuilding: true,
    locale: 'es',
    escribirLeccion,
    verificarFundamento
  }) as Record<string, Herramienta>;
}

function juezSinAvisos() {
  return vi.fn().mockResolvedValue({ avisos: [], estado: 'ok' });
}

async function escribir(escribirLeccion: EscritorDeLecciones, verificarFundamento = juezSinAvisos()) {
  return herramientas(escribirLeccion, verificarFundamento).write_lesson.execute(
    { lessonId: 'S1.L1', brief: 'Cómo se mueve uno por la hoja.', sources: [FUENTE_DE_LA_LECCION.fileName] },
    OPCIONES
  );
}

/** Lo que recibió la base, en orden. */
function guardados(): string[] {
  return vi
    .mocked(upsertLessonLanguageService)
    .mock.calls.map((llamada) => (llamada[1] as { content: string }).content);
}

/** El último informe que quedó al lado de la lección. */
function informe(): Record<string, unknown> {
  const llamada = vi.mocked(updateLessonQuery).mock.calls.at(-1);

  return (llamada?.[1] as { buildReport: Record<string, unknown> }).buildReport;
}

function datosDelInforme(): Array<Record<string, unknown>> {
  return informe().tokenWarnings as Array<Record<string, unknown>>;
}

/** El bloque guardado que contiene un texto, con su tag de apertura. */
function tagDelBloque(html: string, texto: string): string {
  const inicio = html.lastIndexOf('<', html.indexOf(texto));

  return html.slice(inicio, html.indexOf('>', inicio) + 1);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.mocked(listCourseSections).mockResolvedValue(SECCIONES as never);
  vi.mocked(getCourseContentItems).mockResolvedValue(ITEMS as never);
  vi.mocked(listCourseSources).mockResolvedValue([FUENTE_DE_LA_LECCION, OTRA_FUENTE_DEL_CURSO] as never);
  vi.mocked(getChatConversation).mockResolvedValue(CONVERSACION as never);
  vi.mocked(updateLessonQuery).mockResolvedValue(undefined as never);
  // La base de mentira devuelve lo último que se guardó, como la de verdad: la
  // guardia de conservación compara contra eso.
  vi.mocked(getLesson).mockImplementation(
    async () =>
      ({
        id: ID_LECCION,
        title: 'Moverse por la hoja',
        order: 0,
        lessonLanguages: guardados().length > 0 ? [{ locale: 'es', content: guardados().at(-1) }] : []
      }) as never
  );
});

describe('el registro de la ronda', () => {
  it('una lección escrita y después marcada se anota UNA vez, no «(2 veces)»', async () => {
    const { lineasDelRegistro, registroVacio } = await import('@api/services/agent/round-ledger');
    const registro = registroVacio();
    const tools = buildAgentTools('org', 'usuario', 'curso', [], {
      conversationId: ID_CONVERSACION,
      isBuilding: true,
      locale: 'es',
      escribirLeccion: escritorCon(PRIMERA_VERSION, marcadorQueDecide()),
      verificarFundamento: juezSinAvisos(),
      registro
    }) as Record<string, Herramienta>;

    await tools.write_lesson.execute(
      { lessonId: 'S1.L1', brief: 'Cómo se mueve uno por la hoja.', sources: [FUENTE_DE_LA_LECCION.fileName] },
      OPCIONES
    );

    // Hubo dos guardados (la lección y sus marcas), y una sola escritura.
    expect(guardados().length).toBe(2);
    expect(lineasDelRegistro(registro).join('\n')).not.toMatch(/veces/);
  });
});

describe('al marcador sólo le llega lo que no está en ningún lado', () => {
  it('ni el pedido de la docente ni lo que figura en otra fuente del curso', async () => {
    const marcarTokens = marcadorQueDecide();

    await escribir(escritorCon(PRIMERA_VERSION, marcarTokens));

    expect(marcarTokens).toHaveBeenCalledTimes(1);

    const preguntados = marcarTokens.mock.calls[0][0].bloques.flatMap((bloque) => bloque.tokens);

    expect(preguntados).toEqual(expect.arrayContaining(['4471', '180.000 pesos', 'Tab', 'Arlux']));
    // «24 horas» está en el pedido («24 hs») y «Insertar» en otra fuente.
    expect(preguntados).not.toContain('24 horas');
    expect(preguntados).not.toContain('Insertar');
    // La conversación se leyó de la base, con la conversación de la ronda.
    expect(getChatConversation).toHaveBeenCalledWith(ID_CONVERSACION, 'usuario');
  });

  it('cada dato le llega con su bloque, que es lo que se va a marcar', async () => {
    const marcarTokens = marcadorQueDecide();

    await escribir(escritorCon(PRIMERA_VERSION, marcarTokens));

    const bloques = marcarTokens.mock.calls[0][0].bloques;
    const delEjemplo = bloques.find((bloque) => bloque.tokens.includes('4471'));

    expect(delEjemplo?.tokens).toEqual(expect.arrayContaining(['4471', '180.000 pesos']));
    expect(delEjemplo?.texto).toContain('factura 4471');
    expect(guardados()[0]).toContain(`data-block-id="${delEjemplo?.blockId}"`);
  });
});

describe('las decisiones se aplican como marcas y el texto no se toca', () => {
  it('el ejemplo queda marcado, la afirmación sin fuente también, y lo que se mantiene no', async () => {
    await escribir(escritorCon(PRIMERA_VERSION, marcadorQueDecide()));

    const final = guardados().at(-1) as string;

    expect(tagDelBloque(final, 'Un caso: el turno noche')).toContain(
      'data-ejemplo="un caso inventado para mostrar la carga de una factura"'
    );
    expect(tagDelBloque(final, 'El local compra siempre')).toContain('data-sin-fuente=');
    // La tecla se mantuvo: ni la lista ni su renglón llevan marca.
    expect(final).not.toMatch(/<(?:ul|li)[^>]*data-(?:ejemplo|sin-fuente)/);
  });

  it('el texto de la lección es el mismo, letra por letra', async () => {
    await escribir(escritorCon(PRIMERA_VERSION, marcadorQueDecide()));

    const [primera, final] = [guardados()[0], guardados().at(-1) as string];

    expect(final).not.toBe(primera);
    expect(textoParaTokens(final)).toBe(textoParaTokens(primera));
    // Nada se reescribe: la tecla cierta sigue ahí, con las mismas palabras.
    expect(final).toContain('La tecla Tab pasa a la celda de la derecha.');
  });

  it('no se vuelve a llamar ni al escritor ni al juez', async () => {
    const escritor = escritorCon(PRIMERA_VERSION, marcadorQueDecide());
    const juez = juezSinAvisos();

    await escribir(escritor, juez);

    expect(escritor.mock.calls).toHaveLength(1);
    expect(juez).toHaveBeenCalledTimes(1);
  });
});

describe('el informe dice de dónde es cada dato', () => {
  it('lo del pedido, lo de otra fuente y lo que el escritor mantuvo, con su rótulo', async () => {
    await escribir(escritorCon(PRIMERA_VERSION, marcadorQueDecide()));

    const datos = datosDelInforme();

    expect(datos).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ valor: '24 horas', respaldo: 'pedido', rotulo: 'está en tu pedido' }),
        expect.objectContaining({ valor: 'Insertar', respaldo: 'curso', rotulo: 'figura en otra fuente del curso' }),
        expect.objectContaining({ valor: 'Tab', decision: 'mantener', rotulo: ROTULO_MANTENER })
      ])
    );
    // Lo marcado ya está declarado: sale de la lista de dudosos y entra a la
    // de ejemplos y pasajes sin fuente.
    expect(datos.map((dato) => dato.valor)).not.toEqual(expect.arrayContaining(['4471']));
    expect(datos.map((dato) => dato.valor)).not.toContain('Arlux');
    expect(JSON.stringify(informe().examples)).toContain('carga de una factura');
    expect(JSON.stringify(informe().unsupportedPassages)).toContain('Arlux');
  });

  it('y al constructor no le vuelve ninguna orden', async () => {
    const resultado = await escribir(escritorCon(PRIMERA_VERSION, marcadorQueDecide()));

    expect(resultado.unsupportedTokens).toBeUndefined();
    // Cuenta datos, no bloques: la decisión es por dato.
    expect(resultado.tokenPatch).toEqual({ marked: 3, kept: 1, left: 0 });
    expect(String(resultado.note ?? '')).not.toContain('edit_lesson_content');
  });
});

describe('lo que queda sin decidir va al informe, no al constructor', () => {
  it('si el marcador no contesta, la nota dice que están listados para la docente', async () => {
    const marcarTokens = vi.fn().mockResolvedValue([]);
    const resultado = await escribir(escritorCon(PRIMERA_VERSION, marcarTokens as never));

    expect(resultado.unsupportedTokens).toBeUndefined();
    expect(resultado.tokensListedForTeacher).toBe(4);

    const nota = String(resultado.note);

    expect(nota).toContain('listed in the lesson report');
    expect(nota).toContain('Do not edit the lesson');
    expect(nota).not.toContain('Fix that now');
    expect(nota).not.toContain('edit_lesson_content');
    // Una sola escritura: sin decisiones no hay nada que guardar.
    expect(guardados()).toHaveLength(1);
  });

  it('un escritor armado sin marcador se comporta igual', async () => {
    const escritor = escritorCon(PRIMERA_VERSION);
    const resultado = await escribir(escritor);

    expect(escritor.mock.calls).toHaveLength(1);
    expect(resultado.tokensListedForTeacher).toBe(4);
    expect(String(resultado.note)).toContain('Do not edit the lesson');
  });
});

describe('el log del rebote lista todos los datos', () => {
  it('sin cortarlo a los 300 caracteres', async () => {
    // Doce proveedores inventados: la lista pasa largo los 300 caracteres.
    const proveedores = [
      'Arlux',
      'Benzo',
      'Corvia',
      'Dalmer',
      'Estrix',
      'Fenwar',
      'Galdor',
      'Hexis',
      'Irvana',
      'Jorvel',
      'Kentar',
      'Lumbra'
    ];
    const html =
      '<h3>Proveedores</h3>' +
      proveedores.map((p) => `<p>El local le compra a la distribuidora ${p} Sociedad Anónima Comercial.</p>`).join('');

    await escribir(escritorCon(html));

    const linea = vi
      .mocked(console.log)
      .mock.calls.map((llamada) => String(llamada[0]))
      .find((texto) => texto.includes('datos sin respaldo'));

    expect(linea).toBeDefined();
    expect((linea as string).length).toBeGreaterThan(300);
    expect(linea).toContain('Lumbra');
  });
});
