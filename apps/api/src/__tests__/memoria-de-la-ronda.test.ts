/**
 * Lo que la ronda ya hizo, a la vista del modelo mientras trabaja.
 *
 * ── Qué pasaba ───────────────────────────────────────────────────────────────
 *
 * Medido el 2026-11-03: corregir doce lecciones en un mensaje terminó en 35
 * `replace_lesson_block` sobre los mismos tres bloques (nueve veces cada uno).
 * La poda de la ronda borraba las ediciones sin rastro y conservaba la lectura
 * de ANTES de editar: el modelo veía el texto viejo y lo volvía a cambiar.
 *
 * Y `generate_image` le negó una segunda imagen con «the <img> is already in
 * its body», que era falso y no le devolvía la imagen: la perdió.
 *
 * ── Qué se prueba ────────────────────────────────────────────────────────────
 *
 * - la bitácora: qué anota, qué lectura queda vencida y qué nota arma;
 * - la relectura sin fin: la nota deja de pedir releer lo releído, la tercera
 *   lectura del mismo texto se niega, y tres negativas traban la ronda;
 * - que la nota del paso reemplaza a la anterior y no se acumula;
 * - el tercer reemplazo del mismo bloque se niega sin guardar;
 * - `generate_image` exige la lección y, al negar, devuelve la imagen y dice
 *   si está de verdad en el cuerpo.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelMessage, ToolSet } from 'ai';
import { ContentType } from '@cio/utils/constants';

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

vi.mock('@api/services/agent/image-generation', async (original) => ({
  ...(await original<typeof import('@api/services/agent/image-generation')>()),
  generateLessonImage: vi.fn()
}));

vi.mock('@api/services/organization/ai-images', () => ({
  getOrgAiImageSettingsService: vi.fn().mockResolvedValue(null)
}));

import { updateLesson as updateLessonQuery } from '@cio/db/queries/lesson';
import { listCourseSections } from '@api/services/course/section';
import { getCourseContentItems } from '@cio/db/queries/course/content';
import { getLesson } from '@api/services/lesson/lesson';
import { upsertLessonLanguageService } from '@api/services/lesson-language';
import { generateLessonImage } from '@api/services/agent/image-generation';
import { buildAgentTools } from '@api/services/agent/chat-tools';
import { generateImageParam } from '@api/services/agent/agent-tool-schemas';
import {
  anotarLlamada,
  bitacoraVacia,
  conBitacora,
  conNotaDelPaso,
  ENCABEZADO_DE_LA_NOTA,
  esNotaDeLaBitacora,
  idsDeLecturasVencidas,
  idsDeLecturasVigentes,
  idsDeRelecturasNegadas,
  notaDeLaBitacora,
  salioBien,
  trabadaEnRelecturas
} from '@api/services/agent/bitacora-de-la-ronda';
import { enFila } from '@api/services/agent/fila-por-leccion';

const ID = {
  seccion: '11111111-1111-4111-8111-111111111111',
  leccion: 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  otra: 'bbbbbbb2-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
};

const SECCIONES = [{ id: ID.seccion, title: 'Venta en salón', order: 0, createdAt: '2026-01-02T00:00:00Z' }];

const ITEMS = [
  {
    id: ID.leccion,
    type: ContentType.Lesson,
    title: 'El presupuesto',
    sectionId: ID.seccion,
    order: 0,
    hasNoteContent: true,
    questionCount: null
  },
  {
    id: ID.otra,
    type: ContentType.Lesson,
    title: 'La entrega',
    sectionId: ID.seccion,
    order: 1,
    hasNoteContent: true,
    questionCount: null
  }
];

const CONTENIDO = '<p data-block-id="b1">El presupuesto se entrega en el día.</p><p data-block-id="b2">Se firma.</p>';

type Herramienta = { execute: (args: unknown, opciones: unknown) => Promise<Record<string, unknown>> };

function herramientas(presupuesto = { paso: 1, maxPasos: 250 }) {
  return buildAgentTools('org', 'usuario', 'curso', [], {
    conversationId: 'conversacion',
    isBuilding: false,
    locale: 'es',
    presupuesto
  }) as unknown as Record<string, Herramienta>;
}

function opciones(toolCallId: string) {
  return { toolCallId, messages: [] };
}

let cuerpoGuardado = CONTENIDO;

beforeEach(() => {
  vi.clearAllMocks();
  cuerpoGuardado = CONTENIDO;
  vi.mocked(listCourseSections).mockResolvedValue(SECCIONES as never);
  vi.mocked(getCourseContentItems).mockResolvedValue(ITEMS as never);
  vi.mocked(getLesson).mockImplementation(
    async (id: string) =>
      ({
        id,
        title: id === ID.leccion ? 'El presupuesto' : 'La entrega',
        order: 0,
        lessonLanguages: [{ locale: 'es', content: cuerpoGuardado }]
      }) as never
  );
  vi.mocked(updateLessonQuery).mockResolvedValue(undefined as never);
});

describe('la bitácora de la ronda', () => {
  it('una lectura queda vencida cuando la misma pieza se edita después, y sólo entonces', () => {
    const bitacora = bitacoraVacia();

    anotarLlamada(bitacora, {
      paso: 3,
      herramienta: 'get_lesson_content',
      toolCallId: 'lectura-1',
      entrada: { lessonId: 'S1.L1' },
      resultado: { id: ID.leccion, title: 'El presupuesto', content: CONTENIDO }
    });
    anotarLlamada(bitacora, {
      paso: 3,
      herramienta: 'get_lesson_content',
      toolCallId: 'lectura-2',
      entrada: { lessonId: 'S1.L2' },
      resultado: { id: ID.otra, title: 'La entrega', content: '<p>x</p>' }
    });

    expect(idsDeLecturasVencidas(bitacora).size).toBe(0);

    // Una edición NEGADA no cambió nada: la lectura sigue vigente.
    anotarLlamada(bitacora, {
      paso: 4,
      herramienta: 'replace_lesson_block',
      entrada: { lessonId: 'S1.L1', blockId: 'b1', html: '<p>y</p>' },
      resultado: { ok: false, error: 'The replacement produced no change' }
    });

    expect(idsDeLecturasVencidas(bitacora).size).toBe(0);

    // Pedida por id y no por manija: igual es la misma lección, porque la
    // respuesta trae el id resuelto.
    anotarLlamada(bitacora, {
      paso: 5,
      herramienta: 'replace_lesson_block',
      entrada: { lessonId: ID.leccion, blockId: 'b1', html: '<p>y</p>' },
      resultado: { lessonId: ID.leccion, lessonTitle: 'El presupuesto', blockId: 'b1', updated: true }
    });

    expect([...idsDeLecturasVencidas(bitacora)]).toEqual(['lectura-1']);
  });

  it('la nota cuenta lo hecho agrupado, lo negado con su motivo y las lecturas vencidas', () => {
    const bitacora = bitacoraVacia();

    expect(notaDeLaBitacora(bitacora)).toBeUndefined();

    anotarLlamada(bitacora, {
      paso: 2,
      herramienta: 'get_lesson_content',
      toolCallId: 'lectura',
      entrada: { lessonId: 'S1.L1' },
      resultado: { id: ID.leccion, title: 'El presupuesto' }
    });

    for (const [paso, bloque] of [
      [3, 'b1'],
      [4, 'b2']
    ] as const) {
      anotarLlamada(bitacora, {
        paso,
        herramienta: 'replace_lesson_block',
        entrada: { lessonId: 'S1.L1', blockId: bloque, html: '<p>z</p>' },
        resultado: { lessonId: ID.leccion, lessonTitle: 'El presupuesto', blockId: bloque, updated: true }
      });
    }

    anotarLlamada(bitacora, {
      paso: 5,
      herramienta: 'update_questions',
      entrada: { exerciseId: 'S1.E1' },
      resultado: { ok: false, error: 'Question 3 has no evidence' }
    });

    const nota = notaDeLaBitacora(bitacora)!;

    expect(nota.startsWith(ENCABEZADO_DE_LA_NOTA)).toBe(true);
    // Las dos ediciones de la misma lección van en UNA línea, con sus pasos y bloques.
    expect(nota).toContain('- steps 3, 4 · replace_lesson_block ×2 · S1.L1 «El presupuesto» · blocks b1, b2');
    expect(nota).toContain('update_questions · S1.E1 — Question 3 has no evidence');
    expect(nota).toContain('Outdated reads: S1.L1 «El presupuesto»');
    expect(nota).toContain('report as done only what this log lists as saved');
  });

  it('el avance del plan y las preguntas a revisar entran aunque no haya cambios todavía', () => {
    const nota = notaDeLaBitacora(bitacoraVacia(), {
      avanceDelPlan: 'Plan progress: 3 of 12 done.',
      preguntasARevisar: ['«Cuestionario 1»: «¿Cuál es el plazo?» — evidence «se entrega en el día»']
    })!;

    expect(nota).toContain('No change has been saved yet in this round.');
    expect(nota).toContain('Plan progress: 3 of 12 done.');
    expect(nota).toContain('- «Cuestionario 1»: «¿Cuál es el plazo?»');
  });

  // Medido en vivo (2026-11-08): la propuesta se contaba como hecha, la nota la
  // listaba entre «Changes ALREADY saved» y el modelo contestó «Listo, sumé las
  // preguntas» sobre un examen que seguía igual.
  it('una propuesta no está guardada ni negada: espera a la docente, y la nota lo dice', () => {
    const bitacora = bitacoraVacia();

    anotarLlamada(bitacora, {
      paso: 2,
      herramienta: 'get_lesson_content',
      toolCallId: 'lectura',
      entrada: { lessonId: 'S1.L1' },
      resultado: { id: ID.leccion, title: 'El presupuesto' }
    });
    anotarLlamada(bitacora, {
      paso: 3,
      herramienta: 'write_questions',
      entrada: { exerciseId: 'S1.L1' },
      resultado: {
        status: 'needs_teacher_approval',
        proposalId: 'p-1',
        exerciseId: ID.leccion,
        exerciseTitle: 'El presupuesto',
        note: 'NOTHING WAS SAVED.'
      }
    });

    const nota = notaDeLaBitacora(bitacora)!;

    expect(bitacora.escrituras[0]).toMatchObject({ hecho: false, propuesta: true });
    expect(nota).toContain('No change has been saved yet in this round.');
    expect(nota).toContain('PROPOSED and NOT saved');
    expect(nota).toContain('write_questions · S1.L1');
    expect(nota).not.toContain('Changes ALREADY saved');
    expect(nota).not.toContain('Refused or failed');
    // Nada cambió: la lectura de antes no queda vencida.
    expect(nota).not.toContain('Outdated reads');
  });

  it('cómo quedaron las propuestas de antes va en la nota, al final de los mensajes', () => {
    const nota = notaDeLaBitacora(bitacoraVacia(), {
      propuestasAnteriores: '- write_questions on «Examen final»: APPROVED by her and APPLIED by the server'
    })!;

    expect(nota).toContain('APPROVED by her and APPLIED by the server');
  });

  it('las negativas se leen de la respuesta, sean de la forma que sean', () => {
    expect(salioBien({ ok: false, error: 'no' })).toEqual({ hecho: false, motivo: 'no' });
    expect(salioBien({ updated: false, note: 'repetido' })).toEqual({ hecho: false, motivo: 'repetido' });
    expect(salioBien({ generated: false, note: 'tope' }).hecho).toBe(false);
    expect(salioBien({ updated: true }).hecho).toBe(true);
    expect(salioBien('texto').hecho).toBe(true);
  });

  it('la nota del paso reemplaza a la del paso anterior: nunca hay dos', () => {
    const previos: ModelMessage[] = [
      { role: 'user', content: 'Corregí la lección 1.' },
      { role: 'user', content: `${ENCABEZADO_DE_LA_NOTA} — vieja]` },
      { role: 'assistant', content: [{ type: 'text', text: 'Voy.' }] }
    ];

    const conNota = conNotaDelPaso(previos, `${ENCABEZADO_DE_LA_NOTA} — nueva]`);

    expect(conNota.filter(esNotaDeLaBitacora)).toHaveLength(1);
    expect(conNota.at(-1)).toEqual({ role: 'user', content: `${ENCABEZADO_DE_LA_NOTA} — nueva]` });
    expect(conNota[1]).toEqual(previos[2]);

    // Sin nada que sacar ni poner, los mismos mensajes: `prepareStep` no
    // devuelve nada.
    const sinNota: ModelMessage[] = [previos[0], previos[2]];

    expect(conNotaDelPaso(sinNota, undefined)).toBe(sinNota);
  });

  it('el envoltorio anota cada llamada con su paso y su toolCallId', async () => {
    const bitacora = bitacoraVacia();
    let paso = 7;
    const envueltas = conBitacora(
      {
        get_lesson_content: { execute: async () => ({ id: ID.leccion, title: 'El presupuesto' }) },
        replace_lesson_block: {
          execute: async () => ({ lessonId: ID.leccion, lessonTitle: 'El presupuesto', updated: true })
        }
      } as unknown as ToolSet,
      bitacora,
      () => paso
    ) as unknown as Record<string, Herramienta>;

    await envueltas.get_lesson_content.execute({ lessonId: 'S1.L1' }, opciones('lectura'));
    paso = 8;
    await envueltas.replace_lesson_block.execute({ lessonId: 'S1.L1', blockId: 'b1', html: '<p>q</p>' }, opciones('e'));

    expect(bitacora.lecturas).toMatchObject([{ toolCallId: 'lectura', paso: 7 }]);
    expect(bitacora.escrituras).toMatchObject([{ paso: 8, herramienta: 'replace_lesson_block', bloque: 'b1', hecho: true }]);
    expect([...idsDeLecturasVencidas(bitacora)]).toEqual(['lectura']);
  });
});

/**
 * Medido el 2026-11-10, repitiendo en local un pedido real («eliminar la parte
 * de pedidos de carbón»): el modelo cambió el título, releyó la lección, y la
 * leyó 180 veces seguidas —14 minutos, 12 millones de tokens de entrada—. La
 * nota seguía diciendo «Outdated reads… Read again» DESPUÉS de la relectura.
 */
describe('la relectura sin fin', () => {
  const leer = (bitacora: ReturnType<typeof bitacoraVacia>, paso: number, id: string, pieza = 'S1.L1', titulo = 'El presupuesto') =>
    anotarLlamada(bitacora, {
      paso,
      herramienta: 'get_lesson_content',
      toolCallId: id,
      entrada: { lessonId: pieza },
      resultado: { id: pieza === 'S1.L1' ? ID.leccion : `id-de-${pieza}`, title: titulo, content: CONTENIDO }
    });
  const cambiar = (bitacora: ReturnType<typeof bitacoraVacia>, paso: number, pieza = 'S1.L1') =>
    anotarLlamada(bitacora, {
      paso,
      herramienta: 'update_lesson',
      entrada: { lessonId: pieza, title: 'El presupuesto, en el día' },
      resultado: { id: pieza === 'S1.L1' ? ID.leccion : `id-de-${pieza}`, title: 'El presupuesto, en el día', updated: true }
    });

  /** Un juego de herramientas que cuenta cuántas veces se fue a buscar el texto. */
  function envueltas(bitacora: ReturnType<typeof bitacoraVacia>, paso: () => number) {
    const lecturas = vi.fn(async (args: { lessonId: string }) => ({
      id: args.lessonId === 'S1.L1' ? ID.leccion : `id-de-${args.lessonId}`,
      title: 'El presupuesto',
      content: CONTENIDO
    }));
    const juego = conBitacora(
      {
        get_lesson_content: { execute: lecturas },
        replace_lesson_block: {
          execute: async () => ({ lessonId: ID.leccion, lessonTitle: 'El presupuesto', blockId: 'b1', updated: true })
        }
      } as unknown as ToolSet,
      bitacora,
      paso
    ) as unknown as Record<string, Herramienta>;

    return { juego, lecturas };
  }

  it('una pieza que ya se releyó después del cambio no figura más como vencida: la nota dice que ese texto está', () => {
    const bitacora = bitacoraVacia();

    leer(bitacora, 3, 'lectura-1');
    cambiar(bitacora, 4);

    // Cambiada y sin releer: ahí sí hay que pedirlo.
    expect(notaDeLaBitacora(bitacora)).toContain('Outdated reads: S1.L1 «El presupuesto»');
    expect(notaDeLaBitacora(bitacora)).not.toContain('Current texts you ALREADY have');

    leer(bitacora, 5, 'lectura-2', 'S1.L1', 'El presupuesto, en el día');

    const nota = notaDeLaBitacora(bitacora)!;

    expect(nota).not.toContain('Outdated reads');
    expect(nota).toContain('Current texts you ALREADY have');
    expect(nota).toContain('S1.L1 «El presupuesto, en el día» (read at step 5)');
    // La poda: la vieja se va, la nueva se queda.
    expect([...idsDeLecturasVencidas(bitacora)]).toEqual(['lectura-1']);
    expect([...idsDeLecturasVigentes(bitacora)]).toEqual(['lectura-2']);
  });

  it('otra pieza cambiada y sin releer sigue pidiéndose, sola', () => {
    const bitacora = bitacoraVacia();

    leer(bitacora, 2, 'l1');
    leer(bitacora, 2, 'l2', 'S1.L2', 'La entrega');
    cambiar(bitacora, 3);
    cambiar(bitacora, 4, 'S1.L2');
    leer(bitacora, 5, 'l3');

    const nota = notaDeLaBitacora(bitacora)!;

    expect(nota).toContain('Outdated reads: S1.L2 «La entrega» — you changed it after reading.');
    expect(nota).toContain('Current texts you ALREADY have');
    expect(nota).toContain('S1.L1 «El presupuesto» (read at step 5)');
  });

  it('una lectura y un cambio de la misma pieza en el MISMO paso: la lectura queda vencida', () => {
    const bitacora = bitacoraVacia();

    leer(bitacora, 3, 'lectura');
    cambiar(bitacora, 3);

    expect([...idsDeLecturasVencidas(bitacora)]).toEqual(['lectura']);

    // Y al revés: leída después del cambio, dentro del mismo paso, vale.
    leer(bitacora, 3, 'lectura-nueva');

    expect([...idsDeLecturasVigentes(bitacora)]).toEqual(['lectura-nueva']);
  });

  it('la tercera lectura de un texto que no cambió se niega sin ir a buscarlo, y dice dónde está', async () => {
    const bitacora = bitacoraVacia();
    let paso = 2;
    const { juego, lecturas } = envueltas(bitacora, () => paso);

    const primera = await juego.get_lesson_content.execute({ lessonId: 'S1.L1' }, opciones('l1'));
    paso = 3;
    const segunda = await juego.get_lesson_content.execute({ lessonId: 'S1.L1' }, opciones('l2'));
    paso = 4;
    const tercera = await juego.get_lesson_content.execute({ lessonId: 'S1.L1' }, opciones('l3'));

    expect(primera.content).toBe(CONTENIDO);
    expect(segunda.content).toBe(CONTENIDO);
    expect(lecturas).toHaveBeenCalledTimes(2);
    expect(tercera).toMatchObject({ read: false, repeated: true });
    expect(tercera).not.toHaveProperty('content');
    expect(String(tercera.note)).toContain('last at step 3');
    expect(String(tercera.note)).toContain('Do not read it again');
    // Pedida por el id y no por la manija: es la misma pieza.
    expect(await juego.get_lesson_content.execute({ lessonId: ID.leccion }, opciones('l4'))).toMatchObject({ repeated: true });
    expect(lecturas).toHaveBeenCalledTimes(2);

    // La negada no es una lectura: no trae texto y la poda no la conserva.
    expect(bitacora.lecturas.map((lectura) => lectura.toolCallId)).toEqual(['l1', 'l2']);
    expect([...idsDeRelecturasNegadas(bitacora)]).toEqual(['l3', 'l4']);
    expect([...idsDeLecturasVigentes(bitacora)]).toEqual(['l2']);
    expect(salioBien(tercera).hecho).toBe(true);
    expect(bitacora.escrituras).toHaveLength(0);
  });

  it('después de un cambio guardado, la lectura vuelve a estar permitida', async () => {
    const bitacora = bitacoraVacia();
    let paso = 2;
    const { juego, lecturas } = envueltas(bitacora, () => paso);

    await juego.get_lesson_content.execute({ lessonId: 'S1.L1' }, opciones('l1'));
    await juego.get_lesson_content.execute({ lessonId: 'S1.L1' }, opciones('l2'));
    expect(await juego.get_lesson_content.execute({ lessonId: 'S1.L1' }, opciones('l3'))).toMatchObject({ repeated: true });

    paso = 3;
    await juego.replace_lesson_block.execute({ lessonId: 'S1.L1', blockId: 'b1', html: '<p>q</p>' }, opciones('e1'));
    paso = 4;

    const despues = await juego.get_lesson_content.execute({ lessonId: 'S1.L1' }, opciones('l4'));

    expect(despues.content).toBe(CONTENIDO);
    expect(lecturas).toHaveBeenCalledTimes(3);
  });

  it('una pieza que ya salió del contexto se puede volver a leer: no es una relectura de más', async () => {
    const bitacora = bitacoraVacia();
    const { juego, lecturas } = envueltas(bitacora, () => 2);

    await juego.get_lesson_content.execute({ lessonId: 'S1.L1' }, opciones('a1'));
    await juego.get_lesson_content.execute({ lessonId: 'S1.L1' }, opciones('a2'));

    // Ocho piezas más: la poda conserva ocho lecturas, la de S1.L1 se va.
    for (let i = 2; i <= 9; i += 1) {
      await juego.get_lesson_content.execute({ lessonId: `S1.L${i}` }, opciones(`o${i}`));
    }

    expect(idsDeLecturasVigentes(bitacora).has('a2')).toBe(false);

    const otraVez = await juego.get_lesson_content.execute({ lessonId: 'S1.L1' }, opciones('a3'));

    expect(otraVez.content).toBe(CONTENIDO);
    expect(lecturas).toHaveBeenCalledTimes(11);
    // Recién leída: ahora sí, pedirla otra vez está de más.
    expect(await juego.get_lesson_content.execute({ lessonId: 'S1.L1' }, opciones('a4'))).toMatchObject({ repeated: true });
  });

  it('tres relecturas negadas seguidas traban la ronda; una lectura o un cambio en el medio, no', async () => {
    const bitacora = bitacoraVacia();
    const { juego } = envueltas(bitacora, () => 2);

    await juego.get_lesson_content.execute({ lessonId: 'S1.L1' }, opciones('l1'));
    await juego.get_lesson_content.execute({ lessonId: 'S1.L1' }, opciones('l2'));
    await juego.get_lesson_content.execute({ lessonId: 'S1.L1' }, opciones('n1'));
    await juego.get_lesson_content.execute({ lessonId: 'S1.L1' }, opciones('n2'));

    expect(trabadaEnRelecturas(bitacora)).toBe(false);

    // Hizo algo: la cuenta vuelve a empezar.
    await juego.replace_lesson_block.execute({ lessonId: 'S1.L1', blockId: 'b1', html: '<p>q</p>' }, opciones('e1'));
    await juego.get_lesson_content.execute({ lessonId: 'S1.L1' }, opciones('l3'));
    await juego.get_lesson_content.execute({ lessonId: 'S1.L1' }, opciones('l4'));
    await juego.get_lesson_content.execute({ lessonId: 'S1.L1' }, opciones('n3'));
    await juego.get_lesson_content.execute({ lessonId: 'S1.L1' }, opciones('n4'));

    expect(trabadaEnRelecturas(bitacora)).toBe(false);

    await juego.get_lesson_content.execute({ lessonId: 'S1.L1' }, opciones('n5'));

    expect(trabadaEnRelecturas(bitacora)).toBe(true);
    // Y la nota existe aunque la ronda no haya guardado nada más.
    expect(notaDeLaBitacora(bitacora)).toContain('Current texts you ALREADY have');
  });
});

describe('replace_lesson_block no reemplaza el mismo bloque una tercera vez', () => {
  it('dos reemplazos guardan; el tercero se niega sin tocar la lección y dice en qué pasos fueron', async () => {
    const presupuesto = { paso: 4, maxPasos: 250 };
    const tools = herramientas(presupuesto);

    for (const [paso, texto] of [
      [4, 'en 24 horas'],
      [9, 'en el turno siguiente']
    ] as const) {
      presupuesto.paso = paso;
      const hecho = await tools.replace_lesson_block.execute(
        { lessonId: 'S1.L1', blockId: 'b1', html: `<p>El presupuesto se entrega ${texto}.</p>` },
        opciones(`r${paso}`)
      );

      expect(hecho).toMatchObject({ updated: true });
    }

    presupuesto.paso = 12;
    const tercero = await tools.replace_lesson_block.execute(
      { lessonId: 'S1.L1', blockId: 'b1', html: '<p>El presupuesto se entrega en 48 horas.</p>' },
      opciones('r12')
    );

    expect(vi.mocked(upsertLessonLanguageService)).toHaveBeenCalledTimes(2);
    expect(tercero).toMatchObject({ updated: false, repeated: true, blockId: 'b1' });
    expect(String(tercero.note)).toContain('2 times in this round (steps 4, 9)');

    // Otro bloque de la misma lección sigue andando.
    const otroBloque = await tools.replace_lesson_block.execute(
      { lessonId: 'S1.L1', blockId: 'b2', html: '<p>Se firma y se archiva.</p>' },
      opciones('r13')
    );

    expect(otroBloque).toMatchObject({ updated: true });
  });
});

/**
 * Medido el 2026-11-10: cinco `replace_lesson_block` mandados en el mismo paso
 * (el SDK los corre en paralelo). Cada uno leyó la lección entera, sacó su
 * bloque y la guardó entera; el último pisó a los otros. Los cinco dijeron
 * `updated: true` y en la base se borró un bloque solo.
 */
describe('varias ediciones de la misma lección mandadas a la vez', () => {
  /** La base, con la demora que hace visible la carrera: se lee, se piensa, se guarda. */
  function baseConDemora() {
    vi.mocked(getLesson).mockImplementation(async (id: string) => {
      const leido = cuerpoGuardado;

      await new Promise((resolve) => setTimeout(resolve, 5));

      return { id, title: 'El presupuesto', order: 0, lessonLanguages: [{ locale: 'es', content: leido }] } as never;
    });
    vi.mocked(upsertLessonLanguageService).mockImplementation((async (_id: string, datos: { content: string }) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      cuerpoGuardado = datos.content;
    }) as never);
  }

  it('dos reemplazos de bloques distintos en paralelo: quedan los dos', async () => {
    baseConDemora();

    const tools = herramientas();
    const [uno, dos] = await Promise.all([
      tools.replace_lesson_block.execute(
        { lessonId: 'S1.L1', blockId: 'b1', html: '<p>El presupuesto se entrega en 24 horas.</p>' },
        opciones('p1')
      ),
      // La misma lección nombrada por su id: cae en la misma fila que la manija.
      tools.replace_lesson_block.execute(
        { lessonId: ID.leccion, blockId: 'b2', html: '<p>Se firma y se archiva.</p>' },
        opciones('p2')
      )
    ]);

    expect(uno).toMatchObject({ updated: true });
    expect(dos).toMatchObject({ updated: true });
    expect(cuerpoGuardado).toContain('en 24 horas');
    expect(cuerpoGuardado).toContain('Se firma y se archiva.');
  });

  it('borrar los dos bloques en paralelo los borra a los dos', async () => {
    baseConDemora();

    const tools = herramientas();

    await Promise.all([
      tools.replace_lesson_block.execute({ lessonId: 'S1.L1', blockId: 'b1', html: '' }, opciones('b1')),
      tools.replace_lesson_block.execute({ lessonId: 'S1.L1', blockId: 'b2', html: '' }, opciones('b2'))
    ]).catch(() => undefined);

    expect(cuerpoGuardado).not.toContain('se entrega en el día');
    expect(cuerpoGuardado).not.toContain('Se firma.');
  });

  it('una que falla no frena a la que viene detrás, y otra lección no espera', async () => {
    const orden: string[] = [];
    const tarea = (nombre: string, ms: number, falla = false) => async () => {
      orden.push(`empieza ${nombre}`);
      await new Promise((resolve) => setTimeout(resolve, ms));
      orden.push(`termina ${nombre}`);
      if (falla) throw new Error(nombre);

      return nombre;
    };

    const resultados = await Promise.allSettled([
      enFila('leccion-a', tarea('a1', 20, true)),
      enFila('leccion-a', tarea('a2', 1)),
      enFila('leccion-b', tarea('b1', 1))
    ]);

    expect(resultados.map((r) => r.status)).toEqual(['rejected', 'fulfilled', 'fulfilled']);
    // a2 espera a a1 aunque a1 falle; b1 no espera a nadie.
    expect(orden.indexOf('empieza a2')).toBeGreaterThan(orden.indexOf('termina a1'));
    expect(orden.indexOf('termina b1')).toBeLessThan(orden.indexOf('termina a1'));
  });
});

describe('generate_image', () => {
  it('sin lección no se puede pedir: el esquema la exige', () => {
    const sinLeccion = generateImageParam.safeParse({ subject: 'Un mostrador de pinturería con clientes', alt: 'Mostrador' });
    const conLeccion = generateImageParam.safeParse({
      subject: 'Un mostrador de pinturería con clientes',
      alt: 'Mostrador',
      lessonId: 'S1.L1'
    });

    expect(sinLeccion.success).toBe(false);
    expect(conLeccion.success).toBe(true);
  });

  it('la segunda imagen para la misma lección se niega con la imagen ya hecha, y dice que NO está en el cuerpo', async () => {
    vi.mocked(generateLessonImage).mockResolvedValue({
      url: 'https://media.example/curso/leccion-1.jpg',
      aspectRatio: '16:9',
      bytes: 1000,
      styledFromReference: false
    });
    const tools = herramientas();
    const pedido = { lessonId: 'S1.L1', subject: 'Un mostrador de pinturería con clientes', alt: 'Mostrador' };

    const primera = await tools.generate_image.execute(pedido, opciones('i1'));
    const segunda = await tools.generate_image.execute({ ...pedido, subject: 'Otra escena del mostrador' }, opciones('i2'));

    expect(primera).toMatchObject({ generated: true });
    expect(generateLessonImage).toHaveBeenCalledTimes(1);
    expect(segunda).toMatchObject({
      generated: false,
      alreadyGenerated: true,
      inLessonBody: false,
      html: primera.html,
      url: 'https://media.example/curso/leccion-1.jpg'
    });
    expect(String(segunda.note)).toContain('NOT in the lesson body');
  });

  it('si la imagen ya está insertada, la negativa lo dice', async () => {
    vi.mocked(generateLessonImage).mockResolvedValue({
      url: 'https://media.example/curso/leccion-1.jpg',
      aspectRatio: '16:9',
      bytes: 1000,
      styledFromReference: false
    });
    const tools = herramientas();
    const pedido = { lessonId: 'S1.L1', subject: 'Un mostrador de pinturería con clientes', alt: 'Mostrador' };

    await tools.generate_image.execute(pedido, opciones('i1'));
    cuerpoGuardado = `${CONTENIDO}<img src="https://media.example/curso/leccion-1.jpg" alt="Mostrador" />`;
    const segunda = await tools.generate_image.execute(pedido, opciones('i2'));

    expect(segunda).toMatchObject({ generated: false, inLessonBody: true });
  });

  it('el banner tiene su propio tope: uno por ronda', async () => {
    vi.mocked(generateLessonImage).mockResolvedValue({
      url: 'https://media.example/curso/banner.jpg',
      aspectRatio: '16:9',
      bytes: 1000,
      styledFromReference: false
    });
    const tools = herramientas();
    const pedido = { lessonId: 'banner', subject: 'Una pinturería vista desde la vereda', alt: 'Frente' };

    const primero = await tools.generate_image.execute(pedido, opciones('b1'));
    const segundo = await tools.generate_image.execute(pedido, opciones('b2'));

    expect(primero).toMatchObject({ generated: true });
    expect(segundo).toMatchObject({ generated: false, alreadyGenerated: true, url: 'https://media.example/curso/banner.jpg' });
    expect(generateLessonImage).toHaveBeenCalledTimes(1);
    expect(vi.mocked(generateLessonImage).mock.calls[0][0]).toMatchObject({ lessonId: undefined });
  });
});
