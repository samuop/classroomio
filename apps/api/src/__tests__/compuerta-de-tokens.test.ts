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

function herramientas(escribirLeccion: EscritorDeLecciones) {
  return buildAgentTools('org', 'usuario', 'curso', [], {
    conversationId: 'conversacion',
    isBuilding: true,
    locale: 'es',
    escribirLeccion,
    // Sin verificador con modelo: lo que se fija acá es la mitad determinista.
    // La otra tiene su propio archivo y sale a la red.
    verificarFundamento: undefined
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

describe('el rebote al escritor', () => {
  it('le devuelve los datos sin respaldo y le pasa la lección que acaba de escribir', async () => {
    const escritor = vi
      .fn()
      .mockResolvedValueOnce(leccionEscrita(SIN_MARCAR))
      .mockResolvedValueOnce(leccionEscrita(MARCADA));

    const resultado = await escribir(escritor);

    expect(escritor).toHaveBeenCalledTimes(2);

    const segunda = escritor.mock.calls[1][0];
    // El hallazgo, con su contexto, para que sepa qué párrafo tocar.
    expect(segunda.brief).toContain('4471');
    // Y qué hacer con él: las dos marcas, no «borralo».
    expect(segunda.brief).toContain('data-ejemplo');
    expect(segunda.brief).toContain('data-sin-fuente');
    // Con la lección ya escrita delante: corrige, no empieza de nuevo.
    expect(segunda.contenidoActual).toContain('4471');
    // Y el brief original sigue ahí: sin él, el escritor no sabe qué lección es.
    expect(segunda.brief).toContain('Cómo se atiende y se cierra un reclamo.');

    expect(resultado).toMatchObject({ writerRetried: true });
  });

  it('la segunda versión limpia es la que queda guardada, y no vuelve ningún aviso', async () => {
    const escritor = vi
      .fn()
      .mockResolvedValueOnce(leccionEscrita(SIN_MARCAR))
      .mockResolvedValueOnce(leccionEscrita(MARCADA));

    const resultado = await escribir(escritor);

    expect(ultimoGuardado()).toContain('data-ejemplo');
    expect(resultado.unsupportedTokens).toBeUndefined();
  });

  it('no hay una tercera: si la segunda sigue sucia, se guarda igual y el hallazgo vuelve como aviso', async () => {
    // El tope es de uno. Un tercer intento es una llamada de escritor entera por
    // algo que el docente ya puede ver en el informe de la lección.
    const escritor = vi.fn().mockResolvedValue(leccionEscrita(SIN_MARCAR));

    const resultado = await escribir(escritor);

    expect(escritor).toHaveBeenCalledTimes(2);
    expect(resultado.contentWritten).toBe(true);
    expect(resultado.unsupportedTokens).toEqual(expect.arrayContaining([expect.stringContaining('4471')]));
    expect(String(resultado.note)).toContain('data-ejemplo');
  });

  it('una lección limpia no rebota', async () => {
    const escritor = vi.fn().mockResolvedValue(leccionEscrita(MARCADA));

    const resultado = await escribir(escritor);

    expect(escritor).toHaveBeenCalledTimes(1);
    expect(resultado.writerRetried).toBeUndefined();
    expect(resultado.unsupportedTokens).toBeUndefined();
  });

  /**
   * `writerRetried: true` decía que hubo rebote y nada más. Con cinco lecciones
   * rebotando de cinco (medido el 2026-09-22) no se podía saber si el arreglo de
   * los falsos positivos del chequeo de tokens había servido: falta el hallazgo.
   */
  it('el resultado dice POR QUÉ rebotó', async () => {
    const escritor = vi
      .fn()
      .mockResolvedValueOnce(leccionEscrita(SIN_MARCAR))
      .mockResolvedValueOnce(leccionEscrita(MARCADA));

    const resultado = await escribir(escritor);

    expect(resultado.writerRetried).toBe(true);
    expect(String(resultado.writerRetryReason)).toContain('4471');
    // Recortado: el informe de la ronda no es el lugar de una lista de veinte.
    expect(String(resultado.writerRetryReason).length).toBeLessThanOrEqual(301);
  });

  it('si el rebote se cae, queda la primera versión y sus avisos', async () => {
    // Falla abierto, como el resto de los chequeos: perder la lección por no
    // poder pulirla sería cambiar un defecto chico por uno grande.
    const escritor = vi
      .fn()
      .mockResolvedValueOnce(leccionEscrita(SIN_MARCAR))
      .mockRejectedValueOnce(new Error('el proveedor cortó'));

    const resultado = await escribir(escritor);

    expect(resultado.contentWritten).toBe(true);
    expect(resultado.writerRetried).toBeUndefined();
    expect(ultimoGuardado()).toContain('4471');
    expect(resultado.unsupportedTokens).toEqual(expect.arrayContaining([expect.stringContaining('4471')]));
  });

  it('una negativa en el rebote no deja la lección vacía', async () => {
    const escritor = vi
      .fn()
      .mockResolvedValueOnce(leccionEscrita(SIN_MARCAR))
      .mockResolvedValueOnce({ faltaMaterial: 'la circular no trae ejemplos', fuentesUsadas: [], fuentesNoEncontradas: [] });

    const resultado = await escribir(escritor);

    expect(resultado.contentWritten).toBe(true);
    expect(ultimoGuardado()).toContain('Atender un reclamo');
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
    // Una lección que el docente aceptó escribir desde conocimiento general no
    // tiene contra qué buscar sus datos: marcar todo sería el aviso que se
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
