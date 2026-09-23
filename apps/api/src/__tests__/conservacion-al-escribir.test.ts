import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ContentType } from '@cio/utils/constants';

/**
 * Escribir una lección entera no puede llevarse puesto lo que ya estaba.
 *
 * ── Qué se midió ─────────────────────────────────────────────────────────────
 *
 * Producción, 2026-09-22. El riel contra la pérdida de ejemplos existía sólo en
 * los dos caminos quirúrgicos (`replace_lesson_block`, `edit_lesson_content`).
 * Los que guardan el cuerpo ENTERO —el rebote del escritor, `write_lesson` con
 * `lessonId`, `update_lesson_content`— pasaban de largo: `writeLessonBody`
 * guardaba lo que le dieran. En esa corrida rebotaron 5 de 5 lecciones, así que
 * la superficie no era teórica.
 *
 * Y la otra mitad: el juez de fundamento fallaba ABIERTO y MUDO. El `catch`
 * devolvía `[]`, o sea exactamente lo mismo que una lección impecable, así que
 * una caída del proveedor en una construcción de dieciséis lecciones dejaba
 * dieciséis lecciones «limpias» sin rastro en ningún lado.
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
import type { Verificador } from '@api/services/agent/grounding';

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

const DIAGRAMA =
  '<svg data-block-id="d1a9ram0" viewBox="0 0 240 90" width="240" height="90">' +
  '<text x="10" y="20">P2 Alta</text><text x="10" y="50">Primera respuesta: 2 horas</text></svg>';

/** Lo que la lección tiene guardado: dos ejemplos declarados y un diagrama. */
const GUARDADA =
  '<p data-block-id="b1">El escalamiento depende de la prioridad del incidente.</p>' +
  '<p data-block-id="b2" data-ejemplo="caso inventado 1">Caso 1: un faltante entra como P2.</p>' +
  '<p data-block-id="b3" data-ejemplo="caso inventado 2">Caso 2: una rotura entra como P1.</p>' +
  DIAGRAMA;

const OPCIONES = { toolCallId: 'llamada', messages: [] };

type Herramienta = { execute: (args: unknown, opciones: unknown) => Promise<Record<string, unknown>> };

const escribirLeccion = vi.fn();

function herramientas(opciones: { verificarFundamento?: Verificador } = {}) {
  return buildAgentTools('org', 'usuario', 'curso', [], {
    conversationId: 'conversacion',
    isBuilding: true,
    locale: 'es',
    escribirLeccion,
    ...opciones
  }) as Record<string, Herramienta>;
}

/** El informe que quedó guardado al lado de la lección. */
function informe(): Record<string, unknown> {
  const llamada = vi.mocked(updateLessonQuery).mock.calls.at(-1);

  return (llamada?.[1] as { buildReport: Record<string, unknown> }).buildReport;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listCourseSections).mockResolvedValue(SECCIONES as never);
  vi.mocked(getCourseContentItems).mockResolvedValue(ITEMS as never);
  vi.mocked(listCourseSources).mockResolvedValue([] as never);
  vi.mocked(updateLessonQuery).mockResolvedValue(undefined as never);
  // La base de mentira devuelve lo ÚLTIMO que se guardó, como la de verdad. Con
  // un `GUARDADA` fijo, la guardia del rebote comparaba contra el contenido de
  // antes del escritor y no contra la primera versión recién guardada, y el
  // test no distinguía una cosa de la otra.
  vi.mocked(getLesson).mockImplementation(
    async () =>
      ({
        id: ID_LECCION,
        title: 'Cómo se escala un incidente',
        order: 0,
        lessonLanguages: [{ locale: 'es', content: ultimoGuardado() ?? GUARDADA }]
      }) as never
  );
});

/** Lo último que recibió la base, o nada si todavía no se guardó nada. */
function ultimoGuardado(): string | undefined {
  return (vi.mocked(upsertLessonLanguageService).mock.calls.at(-1)?.[1] as { content: string } | undefined)?.content;
}

describe('update_lesson_content sobre una lección que ya tiene contenido', () => {
  it('no guarda nada si la reescritura pierde los ejemplos marcados', async () => {
    const resultado = await herramientas().update_lesson_content.execute(
      { lessonId: 'S1.L1', content: `<p>El escalamiento depende de la prioridad.</p>${DIAGRAMA}` },
      OPCIONES
    );

    expect(upsertLessonLanguageService).not.toHaveBeenCalled();
    expect(resultado.ok).toBe(false);

    const aviso = String(resultado.error);

    expect(aviso).toContain('2 marked examples');
    expect(aviso).toContain('caso inventado 1');
    expect(aviso).toContain('replace_lesson_block');
  });

  it('tampoco si pierde el diagrama, aunque conserve los ejemplos', async () => {
    // El riel viejo contaba SÓLO marcas `data-ejemplo`: un diagrama, una imagen
    // o una tabla se perdían sin que nada dijera nada.
    const resultado = await herramientas().update_lesson_content.execute(
      { lessonId: 'S1.L1', content: GUARDADA.replace(DIAGRAMA, '<p data-block-id="b4">Ver el cuadro adjunto.</p>') },
      OPCIONES
    );

    expect(upsertLessonLanguageService).not.toHaveBeenCalled();
    expect(resultado.ok).toBe(false);
    expect(String(resultado.error)).toContain('1 diagram');
  });

  it('pero cambiar el texto conservando todo SÍ guarda', async () => {
    const resultado = await herramientas().update_lesson_content.execute(
      { lessonId: 'S1.L1', content: GUARDADA.replace('Primera respuesta: 2 horas', 'Primera respuesta: 1 hora') },
      OPCIONES
    );

    expect(resultado).toMatchObject({ lessonId: ID_LECCION, updated: true });

    const guardado = (vi.mocked(upsertLessonLanguageService).mock.calls[0][1] as { content: string }).content;

    expect(guardado).toContain('Primera respuesta: 1 hora');
    expect((guardado.match(/data-ejemplo/g) ?? []).length).toBe(2);
  });

  it('y una lección VACÍA se escribe sin objeciones: no hay nada que perder', async () => {
    vi.mocked(getLesson).mockResolvedValue({
      id: ID_LECCION,
      title: 'Cómo se escala un incidente',
      order: 0,
      lessonLanguages: [{ locale: 'es', content: '' }]
    } as never);

    const resultado = await herramientas().update_lesson_content.execute(
      { lessonId: 'S1.L1', content: '<p>El escalamiento depende de la prioridad.</p>' },
      OPCIONES
    );

    expect(resultado).toMatchObject({ updated: true });
  });
});

describe('el rebote del escritor', () => {
  const aviso = 'This lesson states things the course sources do not support: "atiende las 24 horas".';

  /** El juez marca la primera versión: eso es lo que dispara el rebote. */
  function juezQueMarcaUnaVez(): Verificador {
    let primera = true;

    return vi.fn().mockImplementation(async () => {
      if (primera) {
        primera = false;

        return { avisos: [aviso], estado: 'ok' };
      }

      return { avisos: [], estado: 'ok' };
    }) as unknown as Verificador;
  }

  it('descarta la segunda versión si pierde el diagrama, y conserva la primera', async () => {
    const primeraVersion = GUARDADA.replace('Primera respuesta: 2 horas', 'Primera respuesta: 1 hora');

    escribirLeccion
      .mockResolvedValueOnce({
        html: primeraVersion,
        material: [],
        fuentesUsadas: [],
        fuentesNoEncontradas: [],
        recortadas: []
      })
      .mockResolvedValueOnce({
        // El «arreglo» se lleva puesto el diagrama entero.
        html: primeraVersion.replace(/<svg[\s\S]*<\/svg>/i, ''),
        material: [],
        fuentesUsadas: [],
        fuentesNoEncontradas: [],
        recortadas: []
      });

    const resultado = await herramientas({ verificarFundamento: juezQueMarcaUnaVez() }).write_lesson.execute(
      { lessonId: 'S1.L1', brief: 'Actualizá el plazo del P2.', sources: [] },
      OPCIONES
    );

    expect(escribirLeccion).toHaveBeenCalledTimes(2);
    // Se guardó UNA sola vez: la primera versión. La segunda se tiró.
    expect(upsertLessonLanguageService).toHaveBeenCalledTimes(1);

    const guardado = (vi.mocked(upsertLessonLanguageService).mock.calls[0][1] as { content: string }).content;

    expect(guardado).toContain('<svg');
    expect(resultado).toMatchObject({ contentWritten: true, writerRetried: false });
    expect(String(resultado.writerRetryReason)).toContain('discarded');
    expect(String(resultado.writerRetryReason)).toContain('1 diagram');
  });

  /**
   * Lo que se conserva en el rebote es la PRIMERA versión, no la de antes.
   *
   * La primera versión agrega un diagrama nuevo (el de P3) y la segunda lo
   * tira. Contra el contenido de antes del escritor —un solo diagrama— la
   * segunda no pierde nada y se guardaría; contra la primera, que es lo que está
   * en la base cuando llega la segunda, pierde uno. Es lo que pasa en
   * producción, y un atajo que comparara contra lo leído al empezar dejaría
   * pasar la pérdida.
   */
  it('compara la segunda versión contra la primera recién guardada, no contra la de antes', async () => {
    const diagramaNuevo =
      '<svg viewBox="0 0 240 90" width="240" height="90">' +
      '<text x="10" y="20">P3 Media</text><text x="10" y="50">Primera respuesta: 8 horas</text></svg>';
    const primeraVersion = `${GUARDADA}${diagramaNuevo}`;

    escribirLeccion
      .mockResolvedValueOnce({
        html: primeraVersion,
        material: [],
        fuentesUsadas: [],
        fuentesNoEncontradas: [],
        recortadas: []
      })
      .mockResolvedValueOnce({
        // El «arreglo» vuelve a la lección de antes: sin el diagrama que la
        // primera versión había agregado.
        html: GUARDADA,
        material: [],
        fuentesUsadas: [],
        fuentesNoEncontradas: [],
        recortadas: []
      });

    const resultado = await herramientas({ verificarFundamento: juezQueMarcaUnaVez() }).write_lesson.execute(
      { lessonId: 'S1.L1', brief: 'Agregá el plazo del P3.', sources: [] },
      OPCIONES
    );

    expect(upsertLessonLanguageService).toHaveBeenCalledTimes(1);
    expect(ultimoGuardado()).toContain('P3 Media');
    expect(resultado).toMatchObject({ contentWritten: true, writerRetried: false });
    expect(String(resultado.writerRetryReason)).toContain('1 diagram');
  });

  it('y si la segunda versión conserva todo, esa es la que queda', async () => {
    const primeraVersion = GUARDADA.replace('Primera respuesta: 2 horas', 'Primera respuesta: 1 hora');

    escribirLeccion
      .mockResolvedValueOnce({
        html: primeraVersion,
        material: [],
        fuentesUsadas: [],
        fuentesNoEncontradas: [],
        recortadas: []
      })
      .mockResolvedValueOnce({
        html: primeraVersion.replace('las 24 horas', 'el horario de la mesa'),
        material: [],
        fuentesUsadas: [],
        fuentesNoEncontradas: [],
        recortadas: []
      });

    const resultado = await herramientas({ verificarFundamento: juezQueMarcaUnaVez() }).write_lesson.execute(
      { lessonId: 'S1.L1', brief: 'Actualizá el plazo del P2.', sources: [] },
      OPCIONES
    );

    expect(upsertLessonLanguageService).toHaveBeenCalledTimes(2);
    expect(resultado).toMatchObject({ writerRetried: true });
  });
});

/**
 * La PRIMERA versión del escritor también pasa por la guardia, y el mensaje
 * dice que quien perdió las piezas fue el escritor.
 *
 * El aviso genérico termina en «Do NOT rewrite the whole lesson for this», y
 * bajo una orden `rewrite` del plan eso contradice la orden: el constructor
 * queda sin una jugada legal (`update_lesson_content` está negado bajo orden, y
 * reintentar igual llama al mismo escritor con el mismo brief).
 */
describe('write_lesson sobre una lección que ya tiene contenido', () => {
  const TABLA =
    '<table data-block-id="t1"><tbody><tr><td>P2</td><td>2 horas</td></tr><tr><td>P1</td><td>15 minutos</td></tr></tbody></table>';

  function escritorDevuelve(html: string) {
    escribirLeccion.mockResolvedValueOnce({
      html,
      material: [],
      fuentesUsadas: [],
      fuentesNoEncontradas: [],
      recortadas: []
    });
  }

  it('no guarda nada si la primera versión pierde los ejemplos, y no vuelve a llamar al escritor', async () => {
    escritorDevuelve(`<p>El escalamiento depende de la prioridad.</p>${DIAGRAMA}`);

    const resultado = await herramientas().write_lesson.execute(
      { lessonId: 'S1.L1', brief: 'Actualizá el plazo del P2.', sources: [] },
      OPCIONES
    );

    expect(resultado.ok).toBe(false);
    expect(upsertLessonLanguageService).not.toHaveBeenCalled();
    expect(escribirLeccion).toHaveBeenCalledTimes(1);
    expect(String(resultado.error)).toContain('2 marked examples');
  });

  it('una reescritura que pierde una tabla nombra al escritor y las salidas, sin prohibir reescribir', async () => {
    vi.mocked(getLesson).mockResolvedValue({
      id: ID_LECCION,
      title: 'Cómo se escala un incidente',
      order: 0,
      lessonLanguages: [{ locale: 'es', content: `${GUARDADA}${TABLA}` }]
    } as never);
    // Reescrita desde la circular nueva: en prosa, y la tabla desapareció.
    escritorDevuelve(`${GUARDADA}<p>El P2 se responde en 1 hora y el P1 en 15 minutos.</p>`);

    const resultado = await herramientas().write_lesson.execute(
      { lessonId: 'S1.L1', brief: 'Reescribila con la circular nueva.', sources: [] },
      OPCIONES
    );

    expect(resultado.ok).toBe(false);
    expect(upsertLessonLanguageService).not.toHaveBeenCalled();

    const error = String(resultado.error);

    expect(error).toContain('writer');
    expect(error).toContain('1 table');
    // Las dos salidas reales: pedirla de nuevo nombrando lo que se conserva, o
    // borrar la pieza a propósito por su id y después reescribir.
    expect(error).toContain('write_lesson again');
    expect(error).toContain('replace_lesson_block');
    expect(error).not.toContain('Do NOT rewrite');
  });
});

describe('la lectura del contenido guardado', () => {
  /**
   * Si la base no responde, la guardia no se apaga en silencio.
   *
   * `contenidoGuardado` devolvía vacío ante cualquier falla, y con `antes`
   * vacío la guardia no hace nada: la escritura entera seguía adelante sin
   * que nada dijera que no se había podido comparar.
   */
  it('una lectura que falla niega la escritura en vez de guardar sin comparar', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(getLesson)
      // La primera lectura es la de la herramienta (el título); la segunda, la
      // de la guardia.
      .mockResolvedValueOnce({
        id: ID_LECCION,
        title: 'Cómo se escala un incidente',
        order: 0,
        lessonLanguages: [{ locale: 'es', content: GUARDADA }]
      } as never)
      .mockRejectedValueOnce(new Error('conexión cerrada'));

    const resultado = await herramientas().update_lesson_content.execute(
      { lessonId: 'S1.L1', content: '<p>Una lección sin ejemplos ni diagrama.</p>' },
      OPCIONES
    );

    expect(resultado.ok).toBe(false);
    expect(upsertLessonLanguageService).not.toHaveBeenCalled();
  });
});

describe('el juez de fundamento que no corre', () => {
  /**
   * «No corrió a propósito» viaja con su motivo: sin él, el modelo no distingue
   * una lección corta de un chequeo apagado.
   */
  it('un chequeo salteado llega al modelo con el motivo', async () => {
    const resultado = await herramientas({
      verificarFundamento: vi.fn().mockResolvedValue({
        avisos: [],
        estado: 'skipped',
        motivo: 'the lesson is too short to have checkable claims'
      }) as unknown as Verificador
    }).update_lesson_content.execute(
      { lessonId: 'S1.L1', content: GUARDADA.replace('2 horas', '1 hora') },
      OPCIONES
    );

    expect(resultado).toMatchObject({
      updated: true,
      groundingStatus: 'skipped',
      groundingReason: 'the lesson is too short to have checkable claims'
    });
    expect(informe()).toMatchObject({ groundingStatus: 'skipped' });
  });

  it('lo dice en el informe y en el resultado, y la lección se guarda igual', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const resultado = await herramientas({
      verificarFundamento: vi.fn().mockRejectedValue(new Error('502 del proveedor')) as unknown as Verificador
    }).update_lesson_content.execute(
      { lessonId: 'S1.L1', content: GUARDADA.replace('2 horas', '1 hora') },
      OPCIONES
    );

    // La lección se guarda: el chequeo nunca puede tumbar la escritura.
    expect(upsertLessonLanguageService).toHaveBeenCalledTimes(1);
    expect(resultado).toMatchObject({ updated: true, groundingStatus: 'failed' });
    expect(String(resultado.note)).toContain('did NOT run');
    expect(String(resultado.note)).toContain('502 del proveedor');

    // Y queda escrito al lado de la lección: sin esto, el docente lee el
    // informe y no tiene cómo distinguir «limpia» de «no se miró».
    expect(informe()).toMatchObject({ groundingStatus: 'failed', groundingReason: '502 del proveedor' });
  });

  it('un chequeo que devuelve «no corrió» sin tirar cuenta igual', async () => {
    const resultado = await herramientas({
      verificarFundamento: vi.fn().mockResolvedValue({
        avisos: [],
        estado: 'failed',
        motivo: 'el proveedor devolvió 500'
      }) as unknown as Verificador
    }).update_lesson_content.execute(
      { lessonId: 'S1.L1', content: GUARDADA.replace('2 horas', '1 hora') },
      OPCIONES
    );

    expect(resultado).toMatchObject({ updated: true, groundingStatus: 'failed' });
    expect(informe()).toMatchObject({ groundingStatus: 'failed' });
  });

  it('y un chequeo que corrió limpio queda como «ok» en el informe', async () => {
    const resultado = await herramientas({
      verificarFundamento: vi.fn().mockResolvedValue({ avisos: [], estado: 'ok' }) as unknown as Verificador
    }).update_lesson_content.execute(
      { lessonId: 'S1.L1', content: GUARDADA.replace('2 horas', '1 hora') },
      OPCIONES
    );

    expect(resultado.groundingStatus).toBeUndefined();
    expect(informe()).toMatchObject({ groundingStatus: 'ok' });
  });
});
