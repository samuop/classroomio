import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ContentType } from '@cio/utils/constants';

/**
 * Los datos sin respaldo vuelven al escritor, y el escritor los arregla UNA vez.
 *
 * ── Lo que se midió (2026-09-21/22) ──────────────────────────────────────────
 *
 * El chequeo determinista de tokens encontraba invenciones en las cinco
 * lecciones miradas y sus hallazgos iban SÓLO al informe del docente. El agente
 * seguía construyendo sin enterarse, y el examen se escribía después a partir de
 * ese texto.
 *
 * Devolvérselos al constructor no alcanzaba: él nunca leyó la lección ni tiene
 * las fuentes en su contexto, así que lo que hace es mandar reescribir entera
 * —y cada reescritura es una tirada nueva de invenciones—. Quien puede
 * contestar «ese número es de un ejemplo que inventé» es el escritor, que tiene
 * el material delante.
 *
 * De ahí las dos mitades que se fijan acá: la COMPUERTA (los hallazgos vuelven)
 * y el REBOTE (vuelven al escritor, una sola vez, con la lección ya escrita).
 *
 * ── Lo que cambió el 2026-09-29 ──────────────────────────────────────────────
 *
 * El rebote ya no le pide al escritor la lección ENTERA de nuevo: medido, esa
 * reescritura borraba hechos ciertos y cambiaba el formato de las cifras para
 * que el chequeo dejara de marcarlas, y costaba la mitad del tiempo de escribir.
 * Ahora es un PARCHE: el escritor dice, bloque por bloque, qué es cada dato, y
 * el servidor sólo pone la marca. El detalle está en `rebote-por-parche.test.ts`;
 * acá queda fijado que la compuerta sigue funcionando por ese camino.
 *
 * Curso y circular inventados.
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
import { getLesson } from '@api/services/lesson/lesson';
import { upsertLessonLanguageService } from '@api/services/lesson-language';
import { buildAgentTools } from '@api/services/agent/chat-tools';
import type { Verificador } from '@api/services/agent/grounding';
import type { EscritorDeLecciones } from '@api/services/agent/lesson-writer';

const ID_SECCION = '11111111-1111-4111-8111-111111111111';
const ID_LECCION = 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const SECCIONES = [{ id: ID_SECCION, title: 'Mesa de Ayuda', order: 0, createdAt: '2026-01-01T00:00:00Z' }];

const ITEMS = [
  {
    id: ID_LECCION,
    type: ContentType.Lesson,
    title: 'Cómo se atiende un reclamo',
    sectionId: ID_SECCION,
    order: 0,
    hasNoteContent: true,
    questionCount: null
  }
];

/** La circular que el escritor tuvo delante. No dice nada de facturas ni de Marina. */
const CIRCULAR = {
  fileName: 'circular-mesa-de-ayuda.docx',
  text: 'La Mesa de Ayuda de Distribuidora Andina atiende de 8 a 18. El reclamo se cierra con la conformidad del cliente.'
};

/** Una lección con un ejemplo inventado y SIN marcar: lo que se midió. */
const SIN_MARCAR =
  '<h3>Atender un reclamo</h3>' +
  '<p>La Mesa de Ayuda atiende de 8 a 18 y el reclamo se cierra con la conformidad del cliente. ' +
  'El reclamo se registra, se deriva al área que corresponde y se sigue hasta que el cliente confirma.</p>' +
  '<p>Un caso típico: llega la factura 4471 y el cliente pide una nota de crédito por 180.000 pesos.</p>';

/** La misma lección, con el ejemplo declarado. */
const MARCADA = SIN_MARCAR.replace(
  '<p>Un caso típico:',
  '<p data-ejemplo="un caso inventado para mostrar el circuito">Un caso típico:'
);

const OPCIONES = { toolCallId: 'llamada', messages: [] };

type Herramienta = { execute: (args: unknown, opciones: unknown) => Promise<Record<string, unknown>> };

function leccionEscrita(html: string) {
  return {
    html,
    material: [CIRCULAR],
    fuentesUsadas: [CIRCULAR.fileName],
    fuentesNoEncontradas: [],
    recortadas: []
  };
}

function herramientas(escribirLeccion: EscritorDeLecciones, verificarFundamento?: Verificador) {
  return buildAgentTools('org', 'usuario', 'curso', [], {
    conversationId: 'conversacion',
    isBuilding: true,
    locale: 'es',
    escribirLeccion,
    // Sin verificador con modelo salvo que el test lo pida: lo que se fija acá
    // es la mitad determinista. La otra tiene su propio archivo.
    verificarFundamento
  }) as Record<string, Herramienta>;
}

/** Lo último que se guardó en la lección. */
function ultimoGuardado(): string {
  const llamadas = vi.mocked(upsertLessonLanguageService).mock.calls;

  return (llamadas[llamadas.length - 1]?.[1] as { content: string }).content;
}

async function escribir(escritor: EscritorDeLecciones) {
  return herramientas(escritor).write_lesson.execute(
    { lessonId: 'S1.L1', brief: 'Cómo se atiende y se cierra un reclamo.', sources: [CIRCULAR.fileName] },
    OPCIONES
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listCourseSections).mockResolvedValue(SECCIONES as never);
  vi.mocked(getCourseContentItems).mockResolvedValue(ITEMS as never);
  vi.mocked(getLesson).mockResolvedValue({
    id: ID_LECCION,
    title: 'Cómo se atiende un reclamo',
    order: 0,
    lessonLanguages: []
  } as never);
  // El informe se guarda con `.catch(...)`: sin promesa acá, el guardado del
  // cuerpo se caería por el informe, que es justo lo que no puede pasar.
  vi.mocked(updateLessonQuery).mockResolvedValue(undefined as never);
});

/** El escritor como lo arma la app: la función, con el marcador del parche colgado. */
function escritorConMarcador(html: string, marcarTokens: ReturnType<typeof vi.fn>) {
  return Object.assign(vi.fn().mockResolvedValue(leccionEscrita(html)), {
    marcarTokens
  }) as unknown as EscritorDeLecciones & ReturnType<typeof vi.fn>;
}

/** Un marcador que declara como ejemplo todo bloque que se le pregunta. */
function marcadorDeEjemplos() {
  return vi.fn(async (entrada: { bloques: Array<{ blockId: string; tokens: string[] }> }) =>
    entrada.bloques.flatMap((bloque) =>
      bloque.tokens.map((token) => ({
        blockId: bloque.blockId,
        token,
        accion: 'ejemplo' as const,
        motivo: 'un caso inventado para mostrar el circuito'
      }))
    )
  );
}

describe('el rebote por parche', () => {
  it('el dato sin respaldo vuelve al escritor como pregunta, con su bloque, y no como reescritura', async () => {
    const marcarTokens = marcadorDeEjemplos();
    const escritor = escritorConMarcador(SIN_MARCAR, marcarTokens);

    await escribir(escritor);

    // UNA llamada de escritor: el rebote ya no le pide la lección entera.
    expect(escritor).toHaveBeenCalledTimes(1);
    expect(marcarTokens).toHaveBeenCalledTimes(1);

    const entrada = marcarTokens.mock.calls[0][0] as {
      brief: string;
      bloques: Array<{ texto: string; tokens: string[] }>;
    };

    expect(entrada.bloques).toEqual([
      expect.objectContaining({
        tokens: expect.arrayContaining(['4471']),
        texto: expect.stringContaining('factura 4471')
      })
    ]);
    // Y el brief original sigue ahí: sin él, no sabe de qué lección se trata.
    expect(entrada.brief).toContain('Cómo se atiende y se cierra un reclamo.');
  });

  it('la marca queda puesta y no vuelve ningún aviso', async () => {
    const resultado = await escribir(escritorConMarcador(SIN_MARCAR, marcadorDeEjemplos()));

    expect(ultimoGuardado()).toContain('data-ejemplo="un caso inventado para mostrar el circuito"');
    expect(ultimoGuardado()).toContain('la factura 4471');
    expect(resultado.unsupportedTokens).toBeUndefined();
    // Cuenta datos, no bloques: la decisión es por dato.
    expect(resultado.tokenPatch).toEqual({ marked: 2, kept: 0, left: 0 });
  });

  it('una lección limpia no le pregunta nada a nadie', async () => {
    const marcarTokens = marcadorDeEjemplos();
    const escritor = escritorConMarcador(MARCADA, marcarTokens);

    const resultado = await escribir(escritor);

    expect(escritor).toHaveBeenCalledTimes(1);
    expect(marcarTokens).not.toHaveBeenCalled();
    expect(resultado.writerRetried).toBeUndefined();
    expect(resultado.tokenPatch).toBeUndefined();
    expect(resultado.unsupportedTokens).toBeUndefined();
  });

  it('si el marcador se cae, queda la lección guardada y el dato va al informe', async () => {
    // Falla abierto, como el resto de los chequeos: perder la lección por no
    // poder pulirla sería cambiar un defecto chico por uno grande.
    const marcarTokens = vi.fn().mockRejectedValue(new Error('el proveedor cortó'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const resultado = await escribir(escritorConMarcador(SIN_MARCAR, marcarTokens));

    expect(resultado.contentWritten).toBe(true);
    expect(ultimoGuardado()).toContain('4471');
    expect(resultado.unsupportedTokens).toBeUndefined();
    expect(resultado.tokensListedForTeacher).toBe(2);
    expect(String(resultado.note)).toContain('Do not edit the lesson');
  });

  /**
   * El juez cortado por tiempo: la lección YA está guardada. La nota decía
   * «retry write_lesson later», que es pagar escritor y juez otra vez para
   * reemplazar una lección que no tiene nada malo que se sepa.
   */
  it('si el juez no corrió, la nota lo dice y no manda a reescribir', async () => {
    const juez = vi.fn().mockResolvedValue({
      avisos: [],
      estado: 'failed',
      motivo: 'the check took longer than 25 s and was stopped'
    });

    const resultado = await herramientas(escritorConMarcador(MARCADA, marcadorDeEjemplos()), juez).write_lesson.execute(
      { lessonId: 'S1.L1', brief: 'Cómo se atiende y se cierra un reclamo.', sources: [CIRCULAR.fileName] },
      OPCIONES
    );

    const nota = String(resultado.note);

    expect(resultado).toMatchObject({ groundingStatus: 'failed' });
    expect(nota).toContain('did NOT run');
    expect(nota).toContain('took longer than 25 s');
    expect(nota).toContain('IS saved');
    expect(nota).not.toContain('retry write_lesson');
  });
});

describe('la compuerta', () => {
  it('lo marcado como ejemplo no cuenta: por eso el rebote sirve de algo', async () => {
    // Si contara, el escritor no tendría ninguna salida que no empeorara la
    // lección, y el rebote sería un pedido imposible repetido.
    const escritor = vi.fn().mockResolvedValue(leccionEscrita(MARCADA));
    const resultado = await escribir(escritor);

    expect(resultado.unsupportedTokens).toBeUndefined();
    expect(escritor).toHaveBeenCalledTimes(1);
  });

  it('sin fuentes contra qué contrastar no hay compuerta', async () => {
    // Una lección escrita sin material asignado, desde el conocimiento general,
    // no tiene contra qué buscar sus datos: marcar todo sería el aviso que se
    // aprende a ignorar.
    const escritor = vi.fn().mockResolvedValue({
      html: SIN_MARCAR,
      material: [],
      fuentesUsadas: [],
      fuentesNoEncontradas: [],
      recortadas: []
    });

    const resultado = await herramientas(escritor).write_lesson.execute(
      { lessonId: 'S1.L1', brief: 'Cómo se atiende un reclamo.', sources: [] },
      OPCIONES
    );

    expect(escritor).toHaveBeenCalledTimes(1);
    expect(resultado.unsupportedTokens).toBeUndefined();
  });
});

describe('los ids de bloque los pone el servidor', () => {
  it('una lección recién escrita ya es direccionable por bloque', async () => {
    // Antes los ponía sólo el editor del dashboard, cuando el docente abría y
    // guardaba: hasta entonces `replace_lesson_block` no existía para esa
    // lección y toda corrección era una reescritura entera.
    const escritor = vi.fn().mockResolvedValue(leccionEscrita(MARCADA));

    await escribir(escritor);

    const guardado = ultimoGuardado();

    expect(guardado).toMatch(/<h3 data-block-id="[a-z0-9]{8}">/i);
    expect((guardado.match(/data-block-id=/g) ?? []).length).toBe(3);
  });
});
