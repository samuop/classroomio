import { Hono } from 'hono';
import { MockLanguageModelV4, simulateReadableStream } from 'ai/test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ROLE } from '@cio/utils/constants';

/**
 * `POST /agent/chat` de punta a punta: la ronda termina aunque el navegador se
 * vaya, se cobra paso por paso, se guarda en el servidor, y una sola a la vez.
 *
 * ── Lo que se midió (2026-09-29) ─────────────────────────────────────────────
 *
 * Tres rondas de construcción cortadas —por el proxy a los 120 s de silencio,
 * por un reintento, por un cambio de empresa— no llegaron a `onFinish`: unos
 * 26 pasos del constructor sin descontar del cupo, la conversación congelada
 * en «escribiendo la lección 1.1», y dos rondas vivas a la vez sobre la misma
 * conversación.
 *
 * Esto monta el router real detrás de una sesión armada como la arma `app.ts`,
 * con un modelo simulado que hace lo que hace una ronda chica: pide una
 * herramienta de verdad (`get_course_structure`) y después contesta. Lo que se
 * reemplaza es lo que habla con afuera: la base, Redis, el proveedor.
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

vi.mock('@api/utils/redis/redis', async () => {
  const { redisDePrueba } = await import('./ayuda/redis-de-prueba');

  return { redis: redisDePrueba(), logRedisUnavailableOnce: vi.fn() };
});

vi.mock('@api/services/agent/usage', async (original) => ({
  ...(await original<typeof import('@api/services/agent/usage')>()),
  enforceTokenBalance: vi.fn(async () => {}),
  isOrgOnPaidPlan: vi.fn(async () => true),
  getTokenBalance: vi.fn(async () => ({ used: 0, allowance: 1_000_000, creditBalance: 0, remaining: 1_000_000 })),
  recordTokenUsage: vi.fn(async () => {})
}));

vi.mock('@api/services/platform/settings', async (original) => ({
  ...(await original<typeof import('@api/services/platform/settings')>()),
  providerConfigForOrg: vi.fn(async () => ({ provider: 'google', apiKey: 'clave-de-prueba', model: 'modelo-de-prueba' }))
}));

vi.mock('@cio/ai-assistant/providers', async (original) => ({
  ...(await original<typeof import('@cio/ai-assistant/providers')>()),
  createModel: vi.fn(),
  pickAnyConfiguredProvider: vi.fn(() => ({ provider: 'google', apiKey: 'clave-de-prueba', model: 'modelo-de-prueba' }))
}));

vi.mock('@cio/db', async (original) => ({
  ...(await original<typeof import('@cio/db')>()),
  // La única consulta directa de la ruta: el curso y su empresa.
  db: {
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: () => ({
            limit: async () => [{ title: 'Caja del Almacén Demo', description: null, organizationId: EMPRESA }]
          })
        })
      })
    })
  }
}));

vi.mock('@cio/db/queries/group', async (original) => ({
  ...(await original<typeof import('@cio/db/queries/group')>()),
  isCourseTeamMemberOrOrgAdmin: vi.fn(async () => true)
}));

vi.mock('@cio/db/queries/agent', async (original) => ({
  ...(await original<typeof import('@cio/db/queries/agent')>()),
  getChatConversation: vi.fn(async (id: string) => ({ id, courseId: CURSO })),
  readPlanRegistry: vi.fn(async () => []),
  syncPlanRegistry: vi.fn(async () => []),
  leerAnalisisDeFuente: vi.fn(async () => []),
  getChatDocumentCacheKey: vi.fn(async () => null)
}));

vi.mock('@cio/db/queries/agent/chat-document', async (original) => ({
  ...(await original<typeof import('@cio/db/queries/agent/chat-document')>()),
  listCourseSources: vi.fn(async () => [])
}));

vi.mock('@api/services/course/section', () => ({
  listCourseSections: vi.fn(async () => SECCIONES),
  createCourseSection: vi.fn(),
  updateCourseSectionService: vi.fn(),
  deleteCourseSectionService: vi.fn()
}));

vi.mock('@cio/db/queries/course/content', () => ({
  getCourseContentItems: vi.fn(async () => ITEMS)
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

vi.mock('@api/services/agent/chat-history', async (original) => ({
  ...(await original<typeof import('@api/services/agent/chat-history')>()),
  createChatConversation: vi.fn(async () => ({ id: 'conversacion-de-fuentes' })),
  saveChatMessages: vi.fn(async () => {})
}));

vi.mock('@api/services/agent/document', async (original) => ({
  ...(await original<typeof import('@api/services/agent/document')>()),
  promoteDraftDocuments: vi.fn(async () => {}),
  getDocumentText: vi.fn(async (id: string) => TEXTOS[id] ?? null),
  getDocumentSummary: vi.fn(async () => null)
}));

vi.mock('@api/services/agent/document-cache', async (original) => ({
  ...(await original<typeof import('@api/services/agent/document-cache')>()),
  resolveDocumentCache: vi.fn(async () => ({})),
  recordObservedCacheHit: vi.fn(async () => {})
}));

vi.mock('@api/services/agent/source-index', async (original) => ({
  ...(await original<typeof import('@api/services/agent/source-index')>()),
  buildSourceIndex: vi.fn(async () => INDICE)
}));

vi.mock('@api/config/storage', async (original) => ({
  ...(await original<typeof import('@api/config/storage')>()),
  getStorageConfig: () => ({ mediaPublicBaseUrl: 'https://medios.ejemplo.test' })
}));

const { agentRouter } = await import('@api/routes/agent/agent');
const { redis } = await import('@api/utils/redis/redis');
const { recordTokenUsage, enforceTokenBalance } = await import('@api/services/agent/usage');
const { saveChatMessages } = await import('@api/services/agent/chat-history');
const { createModel } = await import('@cio/ai-assistant/providers');
const { buildSourceIndex } = await import('@api/services/agent/source-index');
const { listCourseSources } = await import('@cio/db/queries/agent/chat-document');
const { getCourseContentItems } = await import('@cio/db/queries/course/content');
const { tomarCandadoDeRonda } = await import('@api/services/agent/ronda-viva');
const { AppError } = await import('@api/utils/errors');
const { hasta, leerPartes } = await import('./ayuda/sse');

// Ids con forma de UUID donde el validador los pide.
const EMPRESA = '00000000-0000-4000-8000-00000000e002';
const CURSO = '00000000-0000-4000-8000-00000000c002';
const DOCENTE = { id: '00000000-0000-4000-8000-00000000a002', email: 'docente@almacen-demo.test', role: null };

const SECCIONES = [{ id: '11111111-1111-4111-8111-111111111111', title: 'Cobrar en la caja', order: 1 }];
const ITEMS = [
  {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    type: 'LESSON',
    title: 'Abrir la caja',
    sectionId: SECCIONES[0].id,
    order: 1,
    hasNoteContent: true,
    hasSlideContent: false,
    videosCount: 0,
    questionCount: null
  }
];

const TEXTO_DEL_MANUAL = 'MANUAL-DE-CAJA: el arqueo se hace al abrir y al cerrar el turno.';
const TEXTO_DE_LA_PAGINA = 'PAGINA-SUELTA: una página que el índice todavía no tiene.';
const TEXTOS: Record<string, string> = {
  'fuente-manual': TEXTO_DEL_MANUAL,
  'pagina-suelta': TEXTO_DE_LA_PAGINA
};

const INDICE = {
  text: '## Course Sources — index (1)\n\n1. "Manual de caja.pdf" (id: fuente-manual) — 12 words, text extracted from the file',
  entries: [
    {
      id: 'fuente-manual',
      fileName: 'Manual de caja.pdf',
      chars: TEXTO_DEL_MANUAL.length,
      words: 12,
      pageCount: 1,
      comoSeLeyo: 'texto' as const,
      resumen: null,
      extracto: 'el arqueo se hace al abrir'
    }
  ]
};

function uso(entrada: number, salida: number) {
  return {
    inputTokens: { total: entrada, noCache: entrada, cacheRead: undefined, cacheWrite: undefined },
    outputTokens: { total: salida, text: salida, reasoning: undefined }
  };
}

const RESPUESTA_FINAL = 'Revisé la estructura: el curso tiene una sección y una lección.';

/** Lo que el proveedor recibió en cada paso, como texto, para buscar qué viajó. */
let promptsRecibidos: string[] = [];

/** Paso 1: pide la estructura del curso. Paso 2: contesta. */
function modeloDeDosPasos() {
  let paso = 0;

  return new MockLanguageModelV4({
    doStream: async ({ prompt }) => {
      promptsRecibidos.push(JSON.stringify(prompt));
      paso += 1;

      const chunks =
        paso === 1
          ? [
              { type: 'stream-start' as const, warnings: [] },
              { type: 'tool-call' as const, toolCallId: 'llamada-1', toolName: 'get_course_structure', input: '{}' },
              { type: 'finish' as const, finishReason: { unified: 'tool-calls' as const, raw: 'tool_use' }, usage: uso(1000, 50) }
            ]
          : [
              { type: 'stream-start' as const, warnings: [] },
              { type: 'text-start' as const, id: 't1' },
              { type: 'text-delta' as const, id: 't1', delta: RESPUESTA_FINAL },
              { type: 'text-end' as const, id: 't1' },
              { type: 'finish' as const, finishReason: { unified: 'stop' as const, raw: 'stop' }, usage: uso(1200, 80) }
            ];

      return { stream: simulateReadableStream({ chunks }) };
    }
  });
}

/** Monta el router real detrás de una sesión armada a mano, como hace `app.ts`. */
function app() {
  return new Hono()
    .use('*', async (c, next) => {
      c.set('user' as never, DOCENTE as never);
      c.set('session' as never, { id: 'sesion-1' } as never);
      c.set('orgRoles' as never, { [EMPRESA]: ROLE.ADMIN } as never);
      await next();
    })
    .route('/agent', agentRouter);
}

const PEDIDO = [{ id: 'mensaje-1', role: 'user', parts: [{ type: 'text', text: 'Revisá la estructura del curso.' }] }];

let contador = 0;
/** Una conversación nueva por test: el candado es por conversación. */
function conversacionNueva(): string {
  contador += 1;
  return `c0a8012e-0000-4000-8000-${String(contador).padStart(12, '0')}`;
}

function chat(cuerpo: Record<string, unknown>) {
  return app().request('/agent/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cio-org-id': EMPRESA },
    body: JSON.stringify({ courseId: CURSO, messages: PEDIDO, context: { locale: 'es' }, ...cuerpo })
  });
}

async function estado() {
  const respuesta = await app().request(`/agent/status?courseId=${CURSO}`, {
    headers: { 'cio-org-id': EMPRESA }
  });

  return (await respuesta.json()) as { data: { activeRound: { conversationId: string; startedAt: string } | null } };
}

beforeEach(() => {
  promptsRecibidos = [];
  vi.mocked(createModel).mockImplementation(() => modeloDeDosPasos() as never);
  vi.mocked(getCourseContentItems).mockImplementation(async () => ITEMS as never);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('una sola ronda viva por conversación', () => {
  it('con la conversación ocupada responde 409 AGENT_ROUND_IN_PROGRESS, sin llamar al modelo', async () => {
    const conversationId = conversacionNueva();
    const otraRonda = await tomarCandadoDeRonda({ redis, conversationId, courseId: CURSO, userId: DOCENTE.id });

    const respuesta = await chat({ conversationId });

    expect(respuesta.status).toBe(409);
    expect(await respuesta.json()).toEqual({
      success: false,
      error: 'A round is already running for this conversation',
      code: 'AGENT_ROUND_IN_PROGRESS'
    });
    expect(createModel).not.toHaveBeenCalled();

    await otraRonda?.soltar();
  });

  it('al terminar la ronda suelta el candado: el pedido siguiente entra', async () => {
    const conversationId = conversacionNueva();

    await leerPartes(await chat({ conversationId }));
    const siguiente = await chat({ conversationId });

    expect(siguiente.status).toBe(200);
    await leerPartes(siguiente);
  });

  it('si el pedido muere antes de la ronda, el candado no queda tomado', async () => {
    const conversationId = conversacionNueva();
    vi.mocked(enforceTokenBalance).mockRejectedValueOnce(
      new AppError('No AI credits left', 'AI_CREDITS_EXHAUSTED', 402)
    );

    const sinCupo = await chat({ conversationId });
    expect(sinCupo.status).toBe(402);

    const conCupo = await chat({ conversationId });
    expect(conCupo.status).toBe(200);
    await leerPartes(conCupo);
  });

  it('si el trabajo previo muere, lo que mandó el docente igual queda guardado', async () => {
    // El panel que ve el error ya no guarda: recarga la conversación del
    // servidor. Sin esto, su último mensaje desaparecería de la pantalla.
    const conversationId = conversacionNueva();
    vi.mocked(buildSourceIndex).mockRejectedValueOnce(new Error('la base no contestó'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const fallida = await chat({ conversationId });

    expect(fallida.status).toBe(500);
    expect(saveChatMessages).toHaveBeenCalledWith(conversationId, DOCENTE.id, PEDIDO);
  });

  it('un pedido rechazado por el cupo no queda guardado: no llegó a ser un turno', async () => {
    // Guardado, el panel lo daba por «conversación recargada» y borraba el
    // aviso del rechazo.
    const conversationId = conversacionNueva();
    vi.mocked(enforceTokenBalance).mockRejectedValueOnce(
      new AppError('No AI credits left', 'AI_CREDITS_EXHAUSTED', 402)
    );

    const sinCupo = await chat({ conversationId });

    expect(sinCupo.status).toBe(402);
    expect(saveChatMessages).not.toHaveBeenCalled();
  });

  it('con la conversación ocupada no pisa lo guardado: ese pedido no se atendió', async () => {
    const conversationId = conversacionNueva();
    const otraRonda = await tomarCandadoDeRonda({ redis, conversationId, courseId: CURSO, userId: DOCENTE.id });

    await chat({ conversationId });

    expect(saveChatMessages).not.toHaveBeenCalled();
    await otraRonda?.soltar();
  });

  it('sin conversación no hay candado ni guardado: la conversación la crea el cliente', async () => {
    await leerPartes(await chat({}));

    expect(redis.set).not.toHaveBeenCalled();
    expect(saveChatMessages).not.toHaveBeenCalled();
  });
});

describe('el consumo, paso por paso', () => {
  it('cada paso deja su fila con su propio uso, y el total no se cobra otra vez', async () => {
    await leerPartes(await chat({ conversationId: conversacionNueva() }));

    // Dos pasos, dos filas: ni una tercera con el total de la ronda.
    expect(recordTokenUsage).toHaveBeenCalledTimes(2);
    expect(vi.mocked(recordTokenUsage).mock.calls).toEqual([
      [
        EMPRESA,
        DOCENTE.id,
        CURSO,
        expect.objectContaining({ promptTokens: 1000, completionTokens: 50, totalTokens: 1050 }),
        'modelo-de-prueba',
        'google'
      ],
      [
        EMPRESA,
        DOCENTE.id,
        CURSO,
        expect.objectContaining({ promptTokens: 1200, completionTokens: 80, totalTokens: 1280 }),
        'modelo-de-prueba',
        'google'
      ]
    ]);
  });
});

describe('si el navegador se va, la ronda termina en el servidor', () => {
  it('corre hasta el final, se cobra entera, se guarda con el id que recibió el cliente y suelta el candado', async () => {
    const conversationId = conversacionNueva();
    // La herramienta tarda: el navegador se va mientras trabaja.
    vi.mocked(getCourseContentItems).mockImplementation(async () => {
      await new Promise((resolver) => setTimeout(resolver, 80));
      return ITEMS as never;
    });

    const { partes, lector } = await leerPartes(
      await chat({ conversationId }),
      (parte) => parte.type !== 'tool-input-available'
    );
    const idDelMensaje = partes.find((parte) => parte.type === 'start')?.messageId;

    // Mientras trabaja, `/agent/status` la muestra: es lo que el panel espera.
    expect((await estado()).data.activeRound).toEqual({ conversationId, startedAt: expect.any(String) });

    await lector.cancel();
    // Dos guardados: el pedido apenas llegó, y la conversación entera al final.
    await hasta(() => vi.mocked(saveChatMessages).mock.calls.length >= 2);

    expect(recordTokenUsage).toHaveBeenCalledTimes(2);
    expect(vi.mocked(saveChatMessages).mock.calls[0]).toEqual([conversationId, DOCENTE.id, PEDIDO]);

    const [idGuardado, persona, mensajes] = vi.mocked(saveChatMessages).mock.calls[1] as [
      string,
      string,
      Array<{ id: string; role: string; parts: Array<{ type: string; text?: string; state?: string }>; metadata?: Record<string, unknown> }>
    ];

    expect(idGuardado).toBe(conversationId);
    expect(persona).toBe(DOCENTE.id);
    expect(mensajes).toHaveLength(2);
    expect(mensajes[0]).toEqual(PEDIDO[0]);

    const respuesta = mensajes[1];
    expect(respuesta.id).toBe(idDelMensaje);
    expect(respuesta.role).toBe('assistant');
    expect(respuesta.parts.find((parte) => parte.type === 'tool-get_course_structure')?.state).toBe('output-available');
    expect(respuesta.parts.filter((parte) => parte.type === 'text').map((parte) => parte.text).join('')).toBe(
      RESPUESTA_FINAL
    );
    // La metadata del cierre, que antes se perdía con el corte.
    expect(respuesta.metadata).toMatchObject({ durationMs: expect.any(Number), finishedAt: expect.any(String) });

    await hasta(() => vi.mocked(redis.eval).mock.calls.length > 0);
    expect((await estado()).data.activeRound).toBeNull();
  });
});

function detener(conversationId: string) {
  return app().request('/agent/chat/stop', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cio-org-id': EMPRESA },
    body: JSON.stringify({ courseId: CURSO, conversationId })
  });
}

describe('«Detener»: la orden de la docente', () => {
  it('termina el paso en curso, no arranca el siguiente, guarda, cobra lo hecho y suelta el candado', async () => {
    const conversationId = conversacionNueva();
    // La herramienta tarda: la docente toca «Detener» mientras trabaja.
    vi.mocked(getCourseContentItems).mockImplementation(async () => {
      await new Promise((resolver) => setTimeout(resolver, 80));
      return ITEMS as never;
    });

    const respuesta = await chat({ conversationId });
    const leyendo = leerPartes(respuesta);

    await hasta(() => promptsRecibidos.length === 1);
    const orden = await detener(conversationId);

    expect(orden.status).toBe(200);
    expect(await orden.json()).toEqual({ success: true, data: { stop: 'pedido' } });

    const { partes } = await leyendo;

    // Un solo pedido al modelo: el segundo paso no arrancó.
    expect(promptsRecibidos).toHaveLength(1);
    // Y lo que estaba haciendo terminó entero.
    expect(partes.some((parte) => parte.type === 'tool-output-available')).toBe(true);
    // Se cobró el paso que corrió, y nada más.
    expect(recordTokenUsage).toHaveBeenCalledTimes(1);

    await hasta(() => vi.mocked(saveChatMessages).mock.calls.length >= 2);
    const [, , mensajes] = vi.mocked(saveChatMessages).mock.calls.at(-1) as [
      string,
      string,
      Array<{ role: string; parts: Array<{ type: string; state?: string }>; metadata?: Record<string, unknown> }>
    ];
    const guardada = mensajes.at(-1)!;

    expect(guardada.role).toBe('assistant');
    expect(guardada.parts.find((parte) => parte.type === 'tool-get_course_structure')?.state).toBe('output-available');
    // La pantalla lo dice «Detenido», no lo confunde con un final normal.
    expect(guardada.metadata).toMatchObject({ stoppedByTeacher: true });

    // La ronda cerró: el pedido siguiente entra, y no lo frena la orden vieja.
    const siguiente = await chat({ conversationId });
    expect(siguiente.status).toBe(200);
    await leerPartes(siguiente);
    expect(promptsRecibidos).toHaveLength(3);
  });

  it('sin la orden, la misma ronda corre sus dos pasos y no dice «Detenido»', async () => {
    const conversationId = conversacionNueva();

    await leerPartes(await chat({ conversationId }));

    expect(promptsRecibidos).toHaveLength(2);
    const [, , mensajes] = vi.mocked(saveChatMessages).mock.calls.at(-1) as [
      string,
      string,
      Array<{ metadata?: Record<string, unknown> }>
    ];
    expect(mensajes.at(-1)?.metadata?.stoppedByTeacher).toBeUndefined();
  });

  it('si la ronda ya terminó, la orden no deja nada puesto', async () => {
    const conversationId = conversacionNueva();

    const orden = await detener(conversationId);

    expect(await orden.json()).toEqual({ success: true, data: { stop: 'sin-ronda' } });
  });

  it('una conversación ajena no se puede detener', async () => {
    const { getChatConversation } = await import('@cio/db/queries/agent');
    vi.mocked(getChatConversation).mockResolvedValueOnce(null as never);

    const orden = await detener(conversacionNueva());

    expect(orden.status).toBe(404);
  });
});

describe('/agent/status por conversación', () => {
  it('contesta por la ronda de ESA conversación aunque haya otra más nueva en el curso', async () => {
    const vieja = conversacionNueva();
    const nueva = conversacionNueva();
    const candadoViejo = await tomarCandadoDeRonda({ redis, conversationId: vieja, courseId: CURSO, userId: DOCENTE.id });
    await new Promise((resolver) => setTimeout(resolver, 5));
    const candadoNuevo = await tomarCandadoDeRonda({ redis, conversationId: nueva, courseId: CURSO, userId: DOCENTE.id });

    const porLaVieja = await app().request(`/agent/status?courseId=${CURSO}&conversationId=${vieja}`, {
      headers: { 'cio-org-id': EMPRESA }
    });

    expect(((await porLaVieja.json()) as { data: { activeRound: { conversationId: string } } }).data.activeRound).toEqual({
      conversationId: vieja,
      startedAt: expect.any(String)
    });

    await candadoViejo?.soltar();
    await candadoNuevo?.soltar();
  });
});

describe('el material de la ronda', () => {
  it('arma el índice de fuentes con la empresa y la persona, para cobrar los resúmenes', async () => {
    await leerPartes(await chat({ conversationId: conversacionNueva() }));

    expect(buildSourceIndex).toHaveBeenCalledWith(
      expect.objectContaining({ courseId: CURSO, orgId: EMPRESA, userId: DOCENTE.id })
    );
  });

  it('una fuente del curso que el panel sigue mandando como adjunta no viaja entera en cada paso', async () => {
    await leerPartes(await chat({ conversationId: conversacionNueva(), context: { locale: 'es', documentId: 'fuente-manual' } }));

    expect(promptsRecibidos.length).toBeGreaterThan(0);
    expect(promptsRecibidos.some((prompt) => prompt.includes('MANUAL-DE-CAJA'))).toBe(false);
  });

  it('un documento que el índice no tiene sí viaja entero, porque si no el modelo no lo vería', async () => {
    await leerPartes(await chat({ conversationId: conversacionNueva(), context: { locale: 'es', documentId: 'pagina-suelta' } }));

    expect(promptsRecibidos.every((prompt) => prompt.includes('PAGINA-SUELTA'))).toBe(true);
  });
});

describe('las fuentes agregadas después del plan', () => {
  const ABRIR_LA_CAJA = {
    type: 'lesson',
    title: 'Abrir la caja',
    description: 'Cómo se abre la caja al empezar el turno.',
    order: 0,
    sources: ['Manual de caja.pdf']
  };

  // La primera lección ya está escrita (ver ITEMS); la segunda todavía no.
  const PLAN_A_MEDIAS = {
    title: 'Caja del Almacén Demo',
    sections: [
      {
        title: 'Cobrar en la caja',
        order: 0,
        items: [
          ABRIR_LA_CAJA,
          {
            type: 'lesson',
            title: 'Hacer el arqueo',
            description: 'Contar el efectivo al cerrar el turno.',
            order: 1,
            sources: ['Manual de caja.pdf']
          }
        ]
      }
    ]
  };

  const PLAN_TERMINADO = {
    title: 'Caja del Almacén Demo',
    sections: [{ title: 'Cobrar en la caja', order: 0, items: [ABRIR_LA_CAJA] }]
  };

  /** La conversación de una construcción: el plan propuesto a las 15:43 y la aprobación. */
  const construccion = (plan: typeof PLAN_A_MEDIAS) => [
    { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'Armá un curso de caja para el almacén.' }] },
    {
      id: 'a1',
      role: 'assistant',
      metadata: { finishedAt: '2026-09-29T15:43:30.000Z' },
      parts: [
        {
          type: 'tool-generate_course_plan',
          toolCallId: 'plan-1',
          state: 'output-available',
          input: plan,
          output: { success: true }
        }
      ]
    },
    {
      id: 'u2',
      role: 'user',
      metadata: { plan: { action: 'implement_course_plan', payload: plan } },
      parts: [{ type: 'text', text: 'Construí el curso según el plan aprobado.' }]
    }
  ];
  const CONSTRUCCION = construccion(PLAN_A_MEDIAS);

  const MANUAL = { id: 'fuente-manual', fileName: 'Manual de caja.pdf', createdAt: '2026-09-29 15:40:00+00' };
  const PLANILLA = {
    id: 'fuente-planilla',
    fileName: 'Planilla de precios (docs.google.com)',
    createdAt: '2026-09-29 15:48:21+00'
  };

  it('el constructor sabe cuáles no están en el plan, para avisarle al docente', async () => {
    vi.mocked(listCourseSources).mockResolvedValue([MANUAL, PLANILLA] as never);

    await leerPartes(await chat({ conversationId: conversacionNueva(), messages: CONSTRUCCION }));

    const prompt = promptsRecibidos[0];
    const aviso = prompt.slice(prompt.indexOf('## Sources added after the plan'));

    expect(prompt).toContain('## Sources added after the plan');
    expect(aviso).toContain('fuente-planilla');
    expect(aviso).not.toContain('fuente-manual');
  });

  it('si el plan ya declara todas las fuentes, no hay aviso', async () => {
    vi.mocked(listCourseSources).mockResolvedValue([MANUAL] as never);

    await leerPartes(await chat({ conversationId: conversacionNueva(), messages: CONSTRUCCION }));

    expect(promptsRecibidos[0]).not.toContain('## Sources added after the plan');
  });

  /** La construcción con una ronda ya hecha, terminada a `terminada`, y el pedido de seguir. */
  const conOtraRonda = (terminada: string) => [
    ...CONSTRUCCION,
    {
      id: 'a2',
      role: 'assistant',
      metadata: { finishedAt: terminada },
      parts: [{ type: 'text', text: 'Escribí la primera lección.' }]
    },
    { id: 'u3', role: 'user', parts: [{ type: 'text', text: 'Seguí construyendo el plan desde donde quedó.' }] }
  ];

  it('la ronda siguiente no lo repite: la anterior ya se lo dijo a la docente', async () => {
    // Con la continuación automática, cada ronda le repetía lo mismo, sin forma
    // de cerrarlo.
    vi.mocked(listCourseSources).mockResolvedValue([MANUAL, PLANILLA] as never);

    await leerPartes(await chat({ conversationId: conversacionNueva(), messages: conOtraRonda('2026-09-29T15:55:00.000Z') }));

    expect(promptsRecibidos[0]).not.toContain('## Sources added after the plan');
  });

  it('una fuente que llegó entre dos rondas se avisa en la siguiente', async () => {
    vi.mocked(listCourseSources).mockResolvedValue([MANUAL, PLANILLA] as never);

    await leerPartes(await chat({ conversationId: conversacionNueva(), messages: conOtraRonda('2026-09-29T15:45:00.000Z') }));

    expect(promptsRecibidos[0]).toContain('## Sources added after the plan');
  });

  it('con el plan terminado tampoco: ya no hay construcción que la deje afuera', async () => {
    vi.mocked(listCourseSources).mockResolvedValue([MANUAL, PLANILLA] as never);

    await leerPartes(
      await chat({ conversationId: conversacionNueva(), messages: construccion(PLAN_TERMINADO as typeof PLAN_A_MEDIAS) })
    );

    expect(promptsRecibidos[0]).not.toContain('## Sources added after the plan');
  });
});
