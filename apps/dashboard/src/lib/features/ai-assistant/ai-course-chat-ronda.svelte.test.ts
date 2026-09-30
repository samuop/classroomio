import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { get } from 'svelte/store';
import { vi } from 'vitest';

// Cada prueba espera, a propósito, lo que tarda la ronda del servidor en
// terminar: unos 4 s aislada. Con toda la tanda corriendo a la vez se pasaba de
// los 5 s por defecto (medido el 2026-09-30) sin que nada estuviera roto.
vi.setConfig({ testTimeout: 15_000 });

import AiCourseChat from './ai-course-chat.svelte';
import { pantallaDelPlan } from './utils/plan-screen.svelte';
import { TEXTO_DE_APROBACION } from './utils/mensajes-de-control';
import { page } from '$app/state';
import { t } from '$lib/utils/functions/translations';
import { ApiError } from '$lib/utils/services/api/types';

/**
 * El panel del chat cuando una ronda no termina limpia (contratos C1-C3, C6).
 *
 * ── Qué se fija ──────────────────────────────────────────────────────────────
 *
 * El panel entero, con el `Chat` y el `DefaultChatTransport` de verdad. Lo
 * único falso es la red y lo que la API guarda:
 *
 * 1. Un corte del stream NO guarda nada a medias: avisa el corte, espera a que
 *    la ronda deje de estar viva en el servidor, y recarga lo que el servidor
 *    guardó. Medido antes: el panel guardaba la herramienta «trabajando» y el
 *    chat quedaba congelado ahí aunque el servidor siguió construyendo.
 * 2. Un 409 (la conversación ya tiene una ronda viva) no se reintenta: el
 *    mensaje vuelve al compositor y se espera a la otra ronda.
 * 3. «Reintentar» vuelve a pedir el MISMO turno —la aprobación, con su marca—
 *    sin agregar una copia.
 * 4. Al abrir una conversación con una ronda viva, el panel lo dice, no deja
 *    mandar, y se actualiza solo cuando termina.
 * 5. La fuente más nueva del curso ya no viaja pegada como `documentId`.
 *
 * La espera pregunta cada 4 s: los casos que esperan una ronda tardan eso.
 */

const falso = vi.hoisted(() => ({
  aiAssistantApi: {
    status: null as unknown,
    conversations: [] as Array<{ id: string; title: string }>,
    currentConversation: null as null | { id: string; messages: unknown[] },
    error: null as string | null,
    fetchStatus: vi.fn(),
    listConversations: vi.fn(),
    loadConversation: vi.fn(),
    createConversation: vi.fn(),
    saveMessages: vi.fn(),
    generateTitle: vi.fn(),
    leerRondaViva: vi.fn(),
    detenerRonda: vi.fn(),
    deleteConversation: vi.fn(),
    renameConversation: vi.fn(),
    compactConversation: vi.fn(),
    summarizeConversation: vi.fn(),
    attachImage: vi.fn(),
    uploadDocument: vi.fn()
  },
  sourcesApi: {
    sources: [] as Array<{ id: string; fileName: string }>,
    listSources: vi.fn(),
    reconcileSources: vi.fn()
  },
  request: vi.fn(),
  reportIncident: vi.fn()
}));

vi.mock('$lib/utils/services/api', async () => {
  const constantes = await vi.importActual<typeof import('$lib/utils/services/api/constants')>(
    '$lib/utils/services/api/constants'
  );

  return {
    AI_REQUEST_TIMEOUT: constantes.AI_REQUEST_TIMEOUT,
    opcionesDeIA: constantes.opcionesDeIA,
    getRequestBaseUrl: () => 'http://localhost/proxy',
    apiClient: { request: falso.request }
  };
});
vi.mock('$lib/utils/services/audit/report-incident', () => ({ reportIncident: falso.reportIncident }));
vi.mock('$features/ai-assistant/api/ai-assistant.svelte', () => ({ aiAssistantApi: falso.aiAssistantApi }));
vi.mock('$features/ai-assistant/api/sources.svelte', () => ({ sourcesApi: falso.sourcesApi }));
vi.mock('$features/course/api', () => ({
  courseApi: { course: null, refreshCourse: vi.fn() },
  lessonApi: { get: vi.fn(), currentLocale: 'es' }
}));
vi.mock('$features/course/utils/exercise-page-utils', () => ({ refreshExercisePageData: vi.fn() }));

// jsdom no implementa el scroll de un elemento, y la lista de mensajes baja
// sola al último. Lo mismo que hace el setup con `scrollIntoView`.
Element.prototype.scrollTo ??= () => {};

const texto = (clave: string) => get(t)(clave);

const sse = (partes: unknown[], { cerrar = true }: { cerrar?: boolean } = {}) =>
  partes.map((parte) => `data: ${JSON.stringify(parte)}\n\n`).join('') + (cerrar ? 'data: [DONE]\n\n' : '');

const respuestaSse = (cuerpo: string) =>
  new Response(cuerpo, { status: 200, headers: { 'content-type': 'text/event-stream' } });

const rondaCompleta = (respuesta: string) => [
  { type: 'start', messageId: 'resp-1' },
  { type: 'start-step' },
  { type: 'text-start', id: 't1' },
  { type: 'text-delta', id: 't1', delta: respuesta },
  { type: 'text-end', id: 't1' },
  { type: 'finish-step' },
  { type: 'finish', finishReason: 'stop' }
];

/** Empieza la ronda (una herramienta en curso) y se corta la conexión. */
function respuestaQueSeCorta(): Response {
  const codificador = new TextEncoder();
  const cuerpo = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        codificador.encode(
          sse(
            [
              { type: 'start', messageId: 'resp-1' },
              { type: 'start-step' },
              { type: 'tool-input-available', toolCallId: 'tc-1', toolName: 'write_lesson', input: { title: 'Arqueo' } }
            ],
            { cerrar: false }
          )
        )
      );
      setTimeout(() => controller.error(new TypeError('network error')), 10);
    }
  });

  return new Response(cuerpo, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

/**
 * Una ronda que empieza (una herramienta en curso) y sigue cuando el test dice.
 *
 * Respeta la señal de corte como un `fetch` de verdad: si el panel corta el
 * stream, la lectura termina con un `AbortError`.
 */
function rondaQueEspera() {
  const codificador = new TextEncoder();
  let controlador!: ReadableStreamDefaultController<Uint8Array>;
  let cerrada = false;
  const cuerpo = new ReadableStream<Uint8Array>({
    start(controller) {
      controlador = controller;
      controller.enqueue(
        codificador.encode(
          sse(
            [
              { type: 'start', messageId: 'resp-1' },
              { type: 'start-step' },
              { type: 'tool-input-available', toolCallId: 'tc-1', toolName: 'write_lesson', input: { title: 'Arqueo' } }
            ],
            { cerrar: false }
          )
        )
      );
    }
  });

  return {
    responder: () =>
      falso.request.mockImplementationOnce(async (_input: unknown, init: RequestInit) => {
        cuerpos.push(JSON.parse(String(init.body)));
        init.signal?.addEventListener('abort', () => {
          if (cerrada) return;
          cerrada = true;
          controlador.error(new DOMException('The user aborted a request.', 'AbortError'));
        });
        return new Response(cuerpo, { status: 200, headers: { 'content-type': 'text/event-stream' } });
      }),
    terminar: (partes: unknown[]) => {
      if (cerrada) return;
      cerrada = true;
      controlador.enqueue(codificador.encode(sse(partes)));
      controlador.close();
    }
  };
}

const vivaEn = (conversationId: string) => ({ conversationId, startedAt: '2026-09-29T18:00:00.000Z' });

let cuerpos: Array<{ trigger: string; messages: Array<Record<string, unknown>>; context?: Record<string, unknown> }>;

function responder(...respuestas: Array<() => Response | Promise<Response>>) {
  for (const respuesta of respuestas) {
    falso.request.mockImplementationOnce(async (_input: unknown, init: RequestInit) => {
      cuerpos.push(JSON.parse(String(init.body)));
      return respuesta();
    });
  }
}

function guardado(mensajes: unknown[]) {
  falso.aiAssistantApi.loadConversation.mockImplementation(async (id: string) => {
    falso.aiAssistantApi.currentConversation = { id, messages: mensajes };
  });
}

async function escribirYMandar(escrito: string) {
  await fireEvent.input(screen.getByRole('textbox'), { target: { value: escrito } });
  await fireEvent.click(screen.getByRole('button', { name: texto('ai_assistant.send') }));
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  cuerpos = [];
  page.params = { id: 'curso-1' };

  falso.aiAssistantApi.status = null;
  falso.aiAssistantApi.conversations = [];
  falso.aiAssistantApi.currentConversation = null;
  falso.aiAssistantApi.fetchStatus.mockResolvedValue(undefined);
  falso.aiAssistantApi.listConversations.mockResolvedValue(undefined);
  falso.aiAssistantApi.createConversation.mockResolvedValue({ id: 'conv-1' });
  falso.aiAssistantApi.saveMessages.mockResolvedValue(undefined);
  falso.aiAssistantApi.generateTitle.mockResolvedValue(null);
  falso.aiAssistantApi.leerRondaViva.mockResolvedValue(null);
  falso.aiAssistantApi.detenerRonda.mockResolvedValue('pedido');
  guardado([]);

  falso.sourcesApi.sources = [{ id: 'src-1', fileName: 'Manual de caja.pdf' }];
  falso.sourcesApi.listSources.mockResolvedValue(undefined);
  falso.sourcesApi.reconcileSources.mockResolvedValue(null);
});

describe('una ronda que termina bien', () => {
  it('se guarda como siempre, y la fuente más nueva NO viaja pegada como documento', async () => {
    responder(() => respuestaSse(sse(rondaCompleta('Listo, armé la sección.'))));

    render(AiCourseChat);
    await escribirYMandar('Armá la sección de cierre');

    await screen.findByText('Listo, armé la sección.');
    await waitFor(() => expect(falso.aiAssistantApi.saveMessages).toHaveBeenCalledTimes(1));

    expect(falso.aiAssistantApi.saveMessages.mock.calls[0][0]).toBe('conv-1');
    // Hay una fuente en el curso, y aun así no se adjunta sola.
    expect(cuerpos[0].context?.documentId).toBeUndefined();
    // El pedido lleva su propio reloj hasta las cabeceras, sin reintento.
    expect(falso.request.mock.calls[0][1]).toMatchObject({ timeout: 90_000, retries: 0 });
  });
});

describe('un corte del stream', () => {
  it(
    'no guarda nada a medias: avisa, espera la ronda del servidor y recarga lo guardado',
    async () => {
      responder(() => respuestaQueSeCorta());
      falso.aiAssistantApi.leerRondaViva.mockResolvedValueOnce(vivaEn('conv-1')).mockResolvedValue(null);
      falso.aiAssistantApi.loadConversation.mockImplementation(async (id: string) => {
        falso.aiAssistantApi.currentConversation = {
          id,
          messages: [
            ...cuerpos[0].messages,
            { id: 'resp-1', role: 'assistant', parts: [{ type: 'text', text: 'Lección escrita en el servidor.' }] }
          ]
        };
      });

      render(AiCourseChat);
      await escribirYMandar('Escribí la lección de arqueo');

      // El corte se dice como corte, no como un problema de la conexión de la docente.
      expect(await screen.findByText(texto('ai_assistant.error_stream_cut'))).toBeInTheDocument();
      expect(screen.queryByText(texto('ai_assistant.error_network'))).toBeNull();

      // La ronda sigue en el servidor: se avisa y no se deja mandar.
      expect(await screen.findByText(texto('ai_assistant.round_in_progress_notice'))).toBeInTheDocument();
      expect(screen.getByRole('textbox')).toBeDisabled();

      expect(falso.reportIncident).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'REQUEST_FAILED', message: 'Stream cut', route: '/agent/chat', status: 0 })
      );

      // Cuando termina, llega lo que guardó el servidor.
      expect(await screen.findByText('Lección escrita en el servidor.', {}, { timeout: 9000 })).toBeInTheDocument();
      expect(screen.queryByText(texto('ai_assistant.round_in_progress_notice'))).toBeNull();
      expect(screen.queryByText(texto('ai_assistant.error_stream_cut'))).toBeNull();
      expect(screen.getByRole('textbox')).not.toBeDisabled();

      // Y el panel nunca guardó la ronda cortada.
      expect(falso.aiAssistantApi.saveMessages).not.toHaveBeenCalled();
    },
    20_000
  );
});

describe('un reinicio del servidor a mitad de ronda', () => {
  it(
    'la respuesta a medias no se pierde: el servidor sólo guardó el pedido, y el panel guarda lo que muestra',
    async () => {
      responder(() => respuestaQueSeCorta());
      falso.aiAssistantApi.leerRondaViva.mockResolvedValueOnce(vivaEn('conv-1')).mockResolvedValue(null);
      // Lo único que llegó a la base: el pedido, guardado apenas se aceptó.
      falso.aiAssistantApi.loadConversation.mockImplementation(async (id: string) => {
        falso.aiAssistantApi.currentConversation = { id, messages: [...cuerpos[0].messages] };
      });

      render(AiCourseChat);
      await escribirYMandar('Escribí la lección de arqueo');

      await waitFor(() => expect(falso.aiAssistantApi.saveMessages).toHaveBeenCalled(), { timeout: 9000 });

      const guardada = falso.aiAssistantApi.saveMessages.mock.calls[0][1] as Array<{
        role: string;
        parts: Array<{ type: string; state?: string }>;
      }>;
      const respuesta = guardada.at(-1)!;

      expect(respuesta.role).toBe('assistant');
      // Guardada cerrada, no «trabajando»: si no, giraría para siempre.
      expect(respuesta.parts.find((parte) => parte.type === 'tool-write_lesson')?.state).toBe('output-error');
    },
    20_000
  );
});

describe('un 409: la conversación ya tiene una ronda viva', () => {
  it(
    'no se reintenta: el mensaje vuelve al compositor y se espera a la otra ronda',
    async () => {
      const cuerpo = JSON.stringify({
        success: false,
        error: 'A round is already running for this conversation',
        code: 'AGENT_ROUND_IN_PROGRESS'
      });
      falso.request.mockRejectedValueOnce(new ApiError(cuerpo, 409, 'Conflict'));
      falso.aiAssistantApi.leerRondaViva.mockResolvedValueOnce(vivaEn('conv-1')).mockResolvedValue(null);
      guardado([
        { id: 'u-otra', role: 'user', parts: [{ type: 'text', text: 'Pedido desde otra pestaña' }] },
        { id: 'a-otra', role: 'assistant', parts: [{ type: 'text', text: 'Hecho en la otra pestaña.' }] }
      ]);

      render(AiCourseChat);
      await escribirYMandar('Agregá un cuestionario');

      expect(await screen.findByText(texto('ai_assistant.error_round_in_progress'))).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: texto('ai_assistant.error_retry') })).toBeNull();
      // Lo que escribió no se perdió.
      expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('Agregá un cuestionario');

      // Terminada la otra ronda, se ve lo que hizo y el aviso se va.
      expect(await screen.findByText('Hecho en la otra pestaña.', {}, { timeout: 9000 })).toBeInTheDocument();
      expect(screen.queryByText(texto('ai_assistant.error_round_in_progress'))).toBeNull();
      expect(falso.request).toHaveBeenCalledTimes(1);
    },
    20_000
  );

  it(
    'aunque lo guardado no traiga esta conversación, al terminar la otra ronda el aviso se va',
    async () => {
      responder(() => respuestaSse(sse(rondaCompleta('Primera respuesta.'))));

      render(AiCourseChat);
      await escribirYMandar('Primer pedido');
      await screen.findByText('Primera respuesta.');

      const cuerpo = JSON.stringify({
        success: false,
        error: 'A round is already running for this conversation',
        code: 'AGENT_ROUND_IN_PROGRESS'
      });
      falso.request.mockRejectedValueOnce(new ApiError(cuerpo, 409, 'Conflict'));
      falso.aiAssistantApi.leerRondaViva.mockResolvedValueOnce(vivaEn('conv-1')).mockResolvedValue(null);
      // Lo guardado no trae la historia de este panel: se queda la local.
      guardado([{ id: 'u-otra', role: 'user', parts: [{ type: 'text', text: 'Otra historia' }] }]);

      await escribirYMandar('Segundo pedido');

      expect(await screen.findByText(texto('ai_assistant.error_round_in_progress'))).toBeInTheDocument();
      await waitFor(() => expect(screen.queryByText(texto('ai_assistant.error_round_in_progress'))).toBeNull(), {
        timeout: 9000
      });
      expect(screen.getByText('Primera respuesta.')).toBeInTheDocument();
      expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('Segundo pedido');
    },
    20_000
  );
});

describe('una ronda que falla: la banda de error se queda', () => {
  // El servidor guarda el pedido apenas lo acepta, antes de trabajar: es lo que
  // encuentra la recarga de una ronda que después falló.
  const pedidoGuardado = () => [...cuerpos[0].messages];

  it(
    'un error del proveedor a mitad de ronda: lo hecho se ve, y el error sigue con su «Reintentar»',
    async () => {
      responder(() =>
        respuestaSse(
          sse([
            { type: 'start', messageId: 'resp-1' },
            { type: 'start-step' },
            { type: 'text-start', id: 't1' },
            { type: 'text-delta', id: 't1', delta: 'Escribí la mitad.' },
            { type: 'text-end', id: 't1' },
            { type: 'error', errorText: 'Error del agente: the model is overloaded' }
          ])
        )
      );
      falso.aiAssistantApi.loadConversation.mockImplementation(async (id: string) => {
        falso.aiAssistantApi.currentConversation = {
          id,
          messages: [
            ...pedidoGuardado(),
            { id: 'resp-1', role: 'assistant', parts: [{ type: 'text', text: 'Escribí la mitad.' }] }
          ]
        };
      });

      render(AiCourseChat);
      await escribirYMandar('Escribí la lección de arqueo');

      expect(await screen.findByText('Error del agente: the model is overloaded')).toBeInTheDocument();
      await waitFor(() => expect(falso.aiAssistantApi.loadConversation).toHaveBeenCalled());
      await new Promise((resolver) => setTimeout(resolver, 50));

      expect(screen.getByText('Escribí la mitad.')).toBeInTheDocument();
      expect(screen.getByText('Error del agente: the model is overloaded')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: texto('ai_assistant.error_retry') })).toBeInTheDocument();
    },
    20_000
  );

  it(
    'un 408 cuya ronda no dejó respuesta: el pedido guardado solo no borra la banda',
    async () => {
      falso.request.mockImplementationOnce(async (_input: unknown, init: RequestInit) => {
        cuerpos.push(JSON.parse(String(init.body)));
        throw new ApiError('Request timeout', 408, 'Request Timeout');
      });
      falso.aiAssistantApi.loadConversation.mockImplementation(async (id: string) => {
        falso.aiAssistantApi.currentConversation = { id, messages: pedidoGuardado() };
      });

      render(AiCourseChat);
      await escribirYMandar('Escribí la lección de arqueo');

      expect(await screen.findByText(texto('ai_assistant.error_timeout_chat'))).toBeInTheDocument();
      await waitFor(() => expect(falso.aiAssistantApi.loadConversation).toHaveBeenCalled());
      await new Promise((resolver) => setTimeout(resolver, 50));

      expect(screen.getByText(texto('ai_assistant.error_timeout_chat'))).toBeInTheDocument();
      expect(screen.getByRole('button', { name: texto('ai_assistant.error_retry') })).toBeInTheDocument();
    },
    20_000
  );

  it('un 402 antes de las cabeceras es la respuesta del servidor: no se espera ninguna ronda', async () => {
    const cuerpo = JSON.stringify({ success: false, error: 'No AI credits left', code: 'AI_CREDITS_EXHAUSTED' });
    falso.request.mockRejectedValueOnce(new ApiError(cuerpo, 402, 'Payment Required'));

    render(AiCourseChat);
    await escribirYMandar('Escribí la lección de arqueo');

    expect(await screen.findByText('No AI credits left')).toBeInTheDocument();
    await new Promise((resolver) => setTimeout(resolver, 50));

    expect(falso.aiAssistantApi.leerRondaViva).not.toHaveBeenCalled();
    expect(falso.aiAssistantApi.loadConversation).not.toHaveBeenCalled();
  });
});

describe('«Detener»', () => {
  const detener = () => screen.getByRole('button', { name: texto('ai_assistant.stop') });

  it(
    'manda la orden y deja terminar el paso en curso: «Deteniendo…», sin cortar y sin guardar a medias',
    async () => {
      const ronda = rondaQueEspera();
      ronda.responder();

      render(AiCourseChat);
      await escribirYMandar('Construí el curso');

      await fireEvent.click(await waitFor(() => detener()));

      expect(falso.aiAssistantApi.detenerRonda).toHaveBeenCalledWith('curso-1', 'conv-1');
      expect(await screen.findByText(texto('ai_assistant.stopping_notice'))).toBeInTheDocument();
      expect(screen.getByRole('button', { name: texto('ai_assistant.stopping') })).toBeDisabled();

      // La herramienta en curso termina y la ronda cierra sola.
      ronda.terminar([
        { type: 'tool-output-available', toolCallId: 'tc-1', output: { success: true } },
        { type: 'finish-step' },
        { type: 'finish', finishReason: 'tool-calls', messageMetadata: { stoppedByTeacher: true } }
      ]);

      expect(await screen.findByText(texto('ai_assistant.stopped_by_teacher'))).toBeInTheDocument();
      await waitFor(() => expect(screen.queryByText(texto('ai_assistant.stopping_notice'))).toBeNull());

      // Un final normal: se guarda la conversación entera, una vez.
      await waitFor(() => expect(falso.aiAssistantApi.saveMessages).toHaveBeenCalledTimes(1));
      const guardada = falso.aiAssistantApi.saveMessages.mock.calls[0][1] as Array<{
        role: string;
        parts: Array<{ type: string; state?: string }>;
      }>;
      expect(guardada.at(-1)?.parts.find((parte) => parte.type === 'tool-write_lesson')?.state).toBe('output-available');
      // Y no arrancó otra ronda sola.
      expect(falso.request).toHaveBeenCalledTimes(1);
    },
    20_000
  );

  it(
    'si la orden no llega, corta como antes, lo avisa, y no guarda lo parcial: espera y recarga',
    async () => {
      const { snackbar } = await import('$features/ui/snackbar/store');
      const aviso = vi.spyOn(snackbar, 'error');
      falso.aiAssistantApi.detenerRonda.mockResolvedValueOnce('sin-redis');
      const ronda = rondaQueEspera();
      ronda.responder();

      render(AiCourseChat);
      await escribirYMandar('Construí el curso');

      await fireEvent.click(await waitFor(() => detener()));

      await waitFor(() => expect(aviso).toHaveBeenCalledWith(texto('ai_assistant.stop_not_delivered')));
      await waitFor(() => expect(falso.aiAssistantApi.loadConversation).toHaveBeenCalled());

      expect(falso.aiAssistantApi.saveMessages).not.toHaveBeenCalled();
      aviso.mockRestore();
    },
    20_000
  );
});

describe('«Reintentar» después de una aprobación que venció', () => {
  it('vuelve a pedir la misma aprobación, con su marca, sin una copia', async () => {
    falso.request.mockImplementationOnce(async (_input: unknown, init: RequestInit) => {
      cuerpos.push(JSON.parse(String(init.body)));
      throw new ApiError('Request timeout', 408, 'Request Timeout');
    });
    responder(() => respuestaSse(sse(rondaCompleta('Construyendo la sección 1.'))));

    render(AiCourseChat);

    const plan = { title: 'Caja en sucursales', sections: [] };
    pantallaDelPlan.acciones?.aprobar(plan);

    // El vencimiento se lee traducido, con el botón para reintentar.
    expect(await screen.findByText(texto('ai_assistant.error_timeout_chat'))).toBeInTheDocument();
    // La aprobación se dibuja como ficha, no como el texto que viaja al modelo.
    expect(screen.getByText(texto('ai_assistant.control_message.plan_approved'))).toBeInTheDocument();

    await fireEvent.click(await screen.findByRole('button', { name: texto('ai_assistant.error_retry') }));

    await screen.findByText('Construyendo la sección 1.');

    expect(cuerpos).toHaveLength(2);
    expect(cuerpos[0].messages.at(-1)).toMatchObject({
      role: 'user',
      parts: [{ type: 'text', text: TEXTO_DE_APROBACION }],
      metadata: { plan: { action: 'implement_course_plan' } }
    });
    expect(cuerpos[1].trigger).toBe('regenerate-message');
    expect(cuerpos[1].messages).toHaveLength(1);
    expect(cuerpos[1].messages[0].id).toBe(cuerpos[0].messages.at(-1)?.id);
    expect(cuerpos[1].messages[0]).toMatchObject({ metadata: { plan: { action: 'implement_course_plan' } } });
  });
});

describe('abrir una conversación con una ronda viva', () => {
  it(
    'lo dice, no deja mandar, y se actualiza solo al terminar',
    async () => {
      localStorage.setItem('ai-chat-active-curso-1', 'conv-7');

      const pedido = { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'Armá el curso' }] };
      const aMedias = {
        id: 'a1',
        role: 'assistant',
        parts: [{ type: 'tool-write_lesson', toolCallId: 'tc-1', state: 'input-available', input: { title: 'Arqueo' } }]
      };
      const completa = { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'Terminado en el servidor.' }] };
      const lecturas = [[pedido, aMedias], [pedido, completa]];

      falso.aiAssistantApi.loadConversation.mockImplementation(async (id: string) => {
        falso.aiAssistantApi.currentConversation = { id, messages: lecturas.shift() ?? [pedido, completa] };
      });
      falso.aiAssistantApi.leerRondaViva.mockResolvedValueOnce(vivaEn('conv-7')).mockResolvedValue(null);

      render(AiCourseChat);

      expect(await screen.findByText(texto('ai_assistant.round_in_progress_notice'))).toBeInTheDocument();
      expect(screen.getByRole('textbox')).toBeDisabled();

      expect(await screen.findByText('Terminado en el servidor.', {}, { timeout: 9000 })).toBeInTheDocument();
      expect(screen.queryByText(texto('ai_assistant.round_in_progress_notice'))).toBeNull();
      expect(screen.getByRole('textbox')).not.toBeDisabled();
      expect(falso.aiAssistantApi.saveMessages).not.toHaveBeenCalled();
    },
    20_000
  );
});
