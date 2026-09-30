import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ContentType } from '@cio/utils/constants';

/**
 * La corrección del escritor no puede tocar lo que el juez no señaló.
 *
 * ── Lo que se midió (producción, 2026-09-29) ─────────────────────────────────
 *
 * La consigna decía «corregí SÓLO esto, todo lo demás idéntico» y nada lo
 * comprobaba: la guardia de conservación cuenta diagramas, tablas y marcas, no
 * el texto. La segunda versión sacó una lista entera por un solo dato, cambió
 * palabras en un bloque que nadie había señalado y pasó cifras al formato de la
 * fuente. Ahora la corrección se compara con la primera versión y se tira si
 * cambió un bloque sin aviso o se llevó un dato del pedido de la docente.
 *
 * Y si la corrección sólo agregó marcas, el juez no se vuelve a llamar: ya vio
 * ese texto.
 *
 * Curso, circular y pedido inventados.
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
import { redactarAviso, type ResultadoDeFundamento } from '@api/services/agent/grounding';
import { guardiaDelRebote } from '@api/services/agent/guardia-del-rebote';

const ID_SECCION = '11111111-1111-4111-8111-111111111111';
const ID_LECCION = 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ID_CONVERSACION = '00000000-0000-4000-8000-00000000f001';

const CIRCULAR = {
  id: 'fuente-1',
  fileName: 'circular-mesa-de-ayuda.docx',
  text: 'La mesa de ayuda atiende de 8 a 18. El reclamo se cierra con la conformidad del cliente.'
};

const CITA = 'los reclamos urgentes se resuelven siempre en menos de una hora';

/** La primera versión: la frase señalada comparte bloque con el «24 horas» del pedido. */
const PRIMERA =
  '<h3>La mesa de ayuda</h3>' +
  '<p>La mesa de ayuda atiende de 8 a 18 y registra cada reclamo en la planilla.</p>' +
  `<p>En el comercio abierto las 24 horas, ${CITA}.</p>` +
  '<p>El reclamo se cierra con la conformidad del cliente.</p>';

const AVISO: ResultadoDeFundamento = {
  avisos: redactarAviso([{ cita: CITA, porque: 'la circular no fija ningún plazo para los urgentes' }]),
  estado: 'ok',
  afirmaciones: [{ cita: CITA, porque: 'la circular no fija ningún plazo para los urgentes' }]
};

const OPCIONES = { toolCallId: 'llamada', messages: [] };

type Herramienta = { execute: (args: unknown, opciones: unknown) => Promise<Record<string, unknown>> };

function version(html: string) {
  return {
    html,
    material: [{ fileName: CIRCULAR.fileName, text: CIRCULAR.text }],
    fuentesUsadas: [CIRCULAR.fileName],
    fuentesNoEncontradas: [],
    recortadas: []
  };
}

/** El juez señala la frase en la primera versión y nada después. */
function juezQueSenalaUnaVez() {
  return vi.fn().mockResolvedValueOnce(AVISO).mockResolvedValue({ avisos: [], estado: 'ok' });
}

async function escribirConRebote(segunda: string, juez = juezQueSenalaUnaVez()) {
  const escritor = vi.fn().mockResolvedValueOnce(version(PRIMERA)).mockResolvedValueOnce(version(segunda));
  const resultado = await (
    buildAgentTools('org', 'usuario', 'curso', [], {
      conversationId: ID_CONVERSACION,
      isBuilding: true,
      locale: 'es',
      escribirLeccion: escritor as never,
      verificarFundamento: juez
    }) as Record<string, Herramienta>
  ).write_lesson.execute(
    { lessonId: 'S1.L1', brief: 'Cómo atiende la mesa de ayuda.', sources: [CIRCULAR.fileName] },
    OPCIONES
  );

  return { resultado, escritor, juez };
}

function guardados(): string[] {
  return vi
    .mocked(upsertLessonLanguageService)
    .mock.calls.map((llamada) => (llamada[1] as { content: string }).content);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.mocked(listCourseSections).mockResolvedValue([
    { id: ID_SECCION, title: 'Atención', order: 0, createdAt: '2026-01-01T00:00:00Z' }
  ] as never);
  vi.mocked(getCourseContentItems).mockResolvedValue([
    {
      id: ID_LECCION,
      type: ContentType.Lesson,
      title: 'La mesa de ayuda',
      sectionId: ID_SECCION,
      order: 0,
      hasNoteContent: false,
      questionCount: null
    }
  ] as never);
  vi.mocked(listCourseSources).mockResolvedValue([CIRCULAR] as never);
  vi.mocked(getChatConversation).mockResolvedValue({
    id: ID_CONVERSACION,
    messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'Es para un comercio que abre 24 hs.' }] }]
  } as never);
  vi.mocked(updateLessonQuery).mockResolvedValue(undefined as never);
  vi.mocked(getLesson).mockImplementation(
    async () =>
      ({
        id: ID_LECCION,
        title: 'La mesa de ayuda',
        order: 0,
        lessonLanguages: guardados().length > 0 ? [{ locale: 'es', content: guardados().at(-1) }] : []
      }) as never
  );
});

describe('la guardia, sola', () => {
  const antes = '<p>Primero.</p><p>Segundo con la frase señalada que el juez marcó como falsa.</p><p>Tercero.</p>';
  const citas = ['la frase señalada que el juez marcó como falsa'];

  it('deja pasar un cambio en el bloque señalado', () => {
    const despues = '<p>Primero.</p><p>Segundo, corregido según el material.</p><p>Tercero.</p>';

    expect(guardiaDelRebote({ antes, despues, citas, protegidos: [] })).toEqual({ conservar: true, soloMarcas: false });
  });

  it('tira la corrección que cambia un bloque que nadie señaló', () => {
    const despues = '<p>Primero, reescrito.</p><p>Segundo, corregido según el material.</p><p>Tercero.</p>';
    const veredicto = guardiaDelRebote({ antes, despues, citas, protegidos: [] });

    expect(veredicto.conservar).toBe(false);
    expect(veredicto.motivo).toContain('did not flag');
  });

  it('tira la que se lleva un dato del pedido, salvo que estuviera adentro de la frase señalada', () => {
    const conDato = '<p>En el comercio de 24 horas, la frase señalada que el juez marcó como falsa.</p>';
    const sinDato = '<p>La corrección según el material.</p>';

    expect(guardiaDelRebote({ antes: conDato, despues: sinDato, citas, protegidos: ['24 horas'] })).toMatchObject({
      conservar: false,
      motivo: expect.stringContaining('24 horas')
    });
    expect(
      guardiaDelRebote({
        antes: conDato,
        despues: sinDato,
        citas: ['comercio de 24 horas, la frase señalada'],
        protegidos: ['24 horas']
      }).conservar
    ).toBe(true);
  });

  it('un cambio de formato en un bloque sin aviso también cuenta como cambio', () => {
    const conCifra = '<p>La hoja tiene 1.048.576 filas.</p><p>La frase señalada que el juez marcó como falsa.</p>';
    const reformateado = '<p>La hoja tiene 1,048,576 filas.</p><p>Corregida.</p>';

    expect(guardiaDelRebote({ antes: conCifra, despues: reformateado, citas, protegidos: [] }).conservar).toBe(false);
  });

  it('si sólo cambiaron atributos lo dice, para no volver a llamar al juez', () => {
    const marcada = antes.replace('<p>Segundo', '<p data-sin-fuente="la circular no lo dice">Segundo');

    expect(guardiaDelRebote({ antes, despues: marcada, citas, protegidos: [] })).toEqual({
      conservar: true,
      soloMarcas: true
    });
  });
});

describe('la guardia en el rebote de write_lesson', () => {
  it('descarta la corrección que tocó otro bloque, y queda la primera', async () => {
    const segunda = PRIMERA.replace(`${CITA}.`, 'los reclamos urgentes se atienden primero.').replace(
      'de 8 a 18',
      'de 8 a 20'
    );
    const { resultado, escritor } = await escribirConRebote(segunda);

    expect(escritor).toHaveBeenCalledTimes(2);
    expect(guardados()).toHaveLength(1);
    expect(guardados()[0]).toContain('de 8 a 18');
    expect(resultado).toMatchObject({ writerRetried: false });
    expect(String(resultado.writerRetryReason)).toContain('discarded');
    // La primera se queda con su aviso: el constructor lo ve.
    expect(resultado.groundingWarnings).toEqual(AVISO.avisos);
  });

  it('descarta la que se llevó el «24 horas» del pedido de la docente', async () => {
    const segunda = PRIMERA.replace(
      `En el comercio abierto las 24 horas, ${CITA}.`,
      'Los reclamos urgentes se atienden primero.'
    );
    const { resultado } = await escribirConRebote(segunda);

    expect(guardados()).toHaveLength(1);
    expect(String(resultado.writerRetryReason)).toContain('24 horas');
  });

  it('guarda la que corrige sólo la frase señalada, y el juez la vuelve a mirar', async () => {
    const segunda = PRIMERA.replace(CITA, 'los reclamos urgentes se atienden primero');
    const { resultado, juez } = await escribirConRebote(segunda);

    expect(guardados()).toHaveLength(2);
    expect(guardados()[1]).toContain('se atienden primero');
    expect(resultado).toMatchObject({ writerRetried: true });
    expect(juez).toHaveBeenCalledTimes(2);
  });

  it('la que sólo marca la frase como sin fuente se guarda SIN volver a llamar al juez', async () => {
    const segunda = PRIMERA.replace(
      '<p>En el comercio abierto',
      '<p data-sin-fuente="la circular no fija plazos para los urgentes">En el comercio abierto'
    );
    const { resultado, juez } = await escribirConRebote(segunda);

    expect(juez).toHaveBeenCalledTimes(1);
    expect(guardados()).toHaveLength(2);
    expect(guardados()[1]).toContain('data-sin-fuente="la circular no fija plazos para los urgentes"');
    // La frase quedó declarada como hueco: el aviso se cierra solo.
    expect(resultado.groundingWarnings).toBeUndefined();
    expect(resultado).toMatchObject({ writerRetried: true });
  });
});
