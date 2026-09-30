import { get } from 'svelte/store';

import { t } from '$lib/utils/functions/translations';
import { ApiError } from '$lib/utils/services/api/types';
import { claveDelErrorDeFuente } from '../utils/errores-del-chat';

/**
 * Las llamadas de IA del dashboard: su reloj, sus reintentos y sus errores.
 *
 * ── Qué se fija ──────────────────────────────────────────────────────────────
 *
 * 1. Que cada llamada que pone a trabajar al modelo pida SU tiempo de espera
 *    y cero reintentos. Todas quedaban en los 30 s de una pantalla común: la
 *    investigación (32 s medidos) vencía en el navegador mientras el servidor
 *    la terminaba, y un reintento automático de un POST lo hacía dos veces.
 * 2. Que un vencimiento de la investigación quede traducido en `error`, que es
 *    lo que muestran el asistente de creación y Fuentes.
 * 3. Que volver a leer una fuente llame a `/reread` (no a `refresh-cache`, que
 *    no relee nada) y devuelva si el texto cambió.
 *
 * Lo único falso es el transporte (`apiClient.request` y el cliente RPC): las
 * clases, sus estados y el reloj son los de verdad.
 */

const falso = vi.hoisted(() => ({
  request: vi.fn(),
  urlPost: vi.fn(),
  rereadPost: vi.fn(),
  statusGet: vi.fn(),
  summarizePost: vi.fn()
}));

vi.mock('$lib/utils/services/api', async () => {
  const constantes = await vi.importActual<typeof import('$lib/utils/services/api/constants')>(
    '$lib/utils/services/api/constants'
  );
  const base = await vi.importActual<typeof import('$lib/utils/services/api/base.svelte')>(
    '$lib/utils/services/api/base.svelte'
  );

  return {
    AI_REQUEST_TIMEOUT: constantes.AI_REQUEST_TIMEOUT,
    opcionesDeIA: constantes.opcionesDeIA,
    llamadaDeIA: constantes.llamadaDeIA,
    BaseApiWithErrors: base.BaseApiWithErrors,
    apiClient: { request: falso.request },
    getRequestBaseUrl: () => 'http://localhost/proxy',
    classroomio: {
      agent: {
        status: { $get: falso.statusGet },
        summarize: { $post: falso.summarizePost },
        documents: {
          url: { $post: falso.urlPost },
          ':documentId': { reread: { $post: falso.rereadPost } }
        }
      }
    }
  };
});

const { aiAssistantApi } = await import('./ai-assistant.svelte');
const { sourcesApi } = await import('./sources.svelte');

const respuesta = (cuerpo: unknown) => new Response(JSON.stringify(cuerpo), { status: 200 });

beforeEach(() => {
  vi.clearAllMocks();
  aiAssistantApi.error = null;
  sourcesApi.error = null;
});

describe('el reloj y los reintentos de cada llamada', () => {
  it('la investigación espera 90 s y no se reintenta sola', async () => {
    falso.request.mockResolvedValue(respuesta({ success: true, data: { queries: [], sources: [], failedCount: 0 } }));

    await aiAssistantApi.research('Caja en sucursales', 'normal');

    const [url, opciones] = falso.request.mock.calls[0];

    expect(url).toBe('http://localhost/proxy/agent/research');
    expect(opciones).toMatchObject({ method: 'POST', timeout: 90_000, retries: 0 });
  });

  it('subir una fuente espera 90 s y no se reintenta sola', async () => {
    falso.request.mockResolvedValue(respuesta({ success: true, data: { documentId: 'd1', fileName: 'a.pdf', wordCount: 1, truncated: false } }));

    await aiAssistantApi.uploadSourceDocument(new File(['x'], 'a.pdf', { type: 'application/pdf' }), 'curso-1');

    expect(falso.request.mock.calls[0][1]).toMatchObject({ timeout: 90_000, retries: 0 });
  });

  it('agregar una página espera 45 s y no se reintenta sola', async () => {
    falso.urlPost.mockResolvedValue(respuesta({ success: true, data: { documentId: 'd2', fileName: 'Página (docs.example)' } }));

    const guardada = await sourcesApi.addUrlSource('curso-1', 'https://docs.example/p');

    expect(falso.urlPost.mock.calls[0][1]).toEqual({ init: { timeout: 45_000, retries: 0 } });
    expect(guardada).toEqual({ documentId: 'd2', fileName: 'Página (docs.example)' });
  });

  it('resumir una conversación espera 60 s', async () => {
    falso.summarizePost.mockResolvedValue(respuesta({ success: true, data: { summary: 'resumen' } }));

    await aiAssistantApi.summarizeConversation([], 'curso-1');

    expect(falso.summarizePost.mock.calls[0][1]).toEqual({ init: { timeout: 60_000, retries: 0 } });
  });
});

describe('los errores que ve la docente', () => {
  it('un vencimiento de la investigación queda traducido, no «Request timeout»', async () => {
    falso.request.mockRejectedValue(new ApiError('Request timeout', 408, 'Request Timeout'));

    const resultado = await aiAssistantApi.research('Caja en sucursales', 'deep');

    expect(resultado).toBeNull();
    expect(aiAssistantApi.error).toBe(get(t)('ai_assistant.error_timeout'));
  });

  it('otro error de la investigación deja su texto, como antes', async () => {
    falso.request.mockRejectedValue(new Error('GOOGLE_API_KEY is not configured'));

    await aiAssistantApi.research('Caja en sucursales', 'quick');

    expect(aiAssistantApi.error).toBe('GOOGLE_API_KEY is not configured');
  });

  it('con el curso lleno, la investigación dice el tope traducido, no el JSON de la respuesta', async () => {
    const cuerpo = JSON.stringify({ success: false, error: 'This course already has 100 sources', code: 'SOURCE_LIMIT_REACHED' });
    falso.request.mockRejectedValue(new ApiError(cuerpo, 422, 'Unprocessable Entity'));

    await aiAssistantApi.research('Caja en sucursales', 'normal', { courseId: 'curso-1' });

    expect(aiAssistantApi.error).toBe(get(t)('course.sources.error_source_limit'));
  });

  it('un archivo que no entra deja el código en `error`, y la pantalla lo traduce', async () => {
    const cuerpo = JSON.stringify({ success: false, error: 'This course already has 100 sources', code: 'SOURCE_LIMIT_REACHED' });
    falso.request.mockRejectedValue(new ApiError(cuerpo, 422, 'Unprocessable Entity'));

    const subida = await aiAssistantApi.uploadSourceDocument(new File(['x'], 'manual.pdf'), 'curso-1');

    expect(subida).toBeNull();
    expect(claveDelErrorDeFuente(aiAssistantApi.error, 'course.sources.upload_failed')).toBe('course.sources.error_source_limit');
  });

  it('guardando varias páginas a la vez, cada una avisa SU error: no se pisan', async () => {
    // El asistente de creación guarda los enlaces en paralelo. Leyendo `error`
    // después, la última que fallaba pisaba a las demás, y una planilla privada
    // quedaba contada como «no se pudo leer» sin decir qué hacer.
    const cuerpo = (code: string) => JSON.stringify({ success: false, error: 'texto del servidor', code });
    falso.urlPost
      .mockRejectedValueOnce(new ApiError(cuerpo('SOURCE_NEEDS_LOGIN'), 422, 'Unprocessable Entity'))
      .mockRejectedValueOnce(new ApiError(cuerpo('SOURCE_UNREADABLE'), 422, 'Unprocessable Entity'));

    const errores: Record<string, string | null> = {};

    await Promise.all([
      sourcesApi.guardarPaginaComoFuente('curso-1', 'https://docs.example/planilla', (error) => (errores.planilla = error)),
      sourcesApi.guardarPaginaComoFuente('curso-1', 'https://docs.example/vacia', (error) => (errores.vacia = error))
    ]);

    expect(claveDelErrorDeFuente(errores.planilla, 'x')).toBe('course.sources.error_needs_login');
    expect(claveDelErrorDeFuente(errores.vacia, 'x')).toBe('course.sources.error_unreadable');
  });

  it('una página que pide iniciar sesión deja el código en `error`, y la pantalla lo traduce', async () => {
    const cuerpo = JSON.stringify({ success: false, error: 'The page asks to sign in', code: 'SOURCE_NEEDS_LOGIN' });
    falso.urlPost.mockRejectedValue(new ApiError(cuerpo, 422, 'Unprocessable Entity'));

    const guardada = await sourcesApi.addUrlSource('curso-1', 'https://docs.example/privada');

    expect(guardada).toBeNull();
    expect(claveDelErrorDeFuente(sourcesApi.error, 'course.sources.url_failed')).toBe('course.sources.error_needs_login');
  });
});

describe('volver a leer una fuente', () => {
  it('llama a /reread con su reloj y devuelve si el texto cambió', async () => {
    falso.rereadPost.mockResolvedValue(
      respuesta({ success: true, data: { changed: true, before: 900, after: 1200, pageCount: 4, wordCount: 1200 } })
    );

    const relectura = await sourcesApi.releerFuente('src-1');

    expect(falso.rereadPost).toHaveBeenCalledWith({ param: { documentId: 'src-1' } }, { init: { timeout: 90_000, retries: 0 } });
    expect(relectura).toEqual({ changed: true, wordCount: 1200 });
    // El ícono de la tarjeta deja de girar.
    expect(sourcesApi.refreshingId).toBeNull();
  });

  it('sin cambios, `changed` es falso', async () => {
    falso.rereadPost.mockResolvedValue(respuesta({ success: true, data: { changed: false, wordCount: 900 } }));

    expect(await sourcesApi.releerFuente('src-1')).toEqual({ changed: false, wordCount: 900 });
  });

  it('si falla devuelve null y deja el código en `error`', async () => {
    const cuerpo = JSON.stringify({ success: false, error: 'No useful text', code: 'SOURCE_UNREADABLE' });
    falso.rereadPost.mockRejectedValue(new ApiError(cuerpo, 422, 'Unprocessable Entity'));

    expect(await sourcesApi.releerFuente('src-1')).toBeNull();
    expect(claveDelErrorDeFuente(sourcesApi.error, 'x')).toBe('course.sources.error_unreadable');
  });
});

describe('la ronda viva del curso', () => {
  it('la lee del estado, y de paso lo guarda', async () => {
    const estado = { role: 'teacher', activeRound: { conversationId: 'conv-1', startedAt: '2026-09-29T18:00:00.000Z' } };
    falso.statusGet.mockResolvedValue(respuesta({ success: true, data: estado }));

    expect(await aiAssistantApi.leerRondaViva('curso-1')).toEqual({
      conversationId: 'conv-1',
      startedAt: '2026-09-29T18:00:00.000Z'
    });
    expect(falso.statusGet).toHaveBeenCalledWith({ query: { courseId: 'curso-1' } });
    expect(aiAssistantApi.status).toEqual(estado);
  });

  it('sin ronda, null; sin poder preguntar, undefined — y no pisa `error`', async () => {
    falso.statusGet.mockResolvedValueOnce(respuesta({ success: true, data: { activeRound: null } }));
    expect(await aiAssistantApi.leerRondaViva('curso-1')).toBeNull();

    aiAssistantApi.error = 'un error de otra pantalla';
    falso.statusGet.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    expect(await aiAssistantApi.leerRondaViva('curso-1')).toBeUndefined();
    expect(aiAssistantApi.error).toBe('un error de otra pantalla');
  });
});
