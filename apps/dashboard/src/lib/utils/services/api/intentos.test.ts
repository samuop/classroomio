import { AI_REQUEST_TIMEOUT, AI_REQUEST_TIMEOUT_MAX, llamadaDeIA, opcionesDeIA } from './constants';
import { MENSAJE_DE_TIEMPO_AGOTADO, pedirConReintentos, type PedidoConReintentos } from './intentos';
import { ApiError } from './types';

/**
 * El reloj y los reintentos de cada pedido del dashboard.
 *
 * ── Qué se fija ──────────────────────────────────────────────────────────────
 *
 * 1. Que CADA intento tenga reloj. Había uno solo, armado antes del bucle, y el
 *    primer intento lo apagaba al recibir cabeceras: el reintento después de un
 *    502 corría sin tiempo de espera y un pedido colgado ahí no terminaba nunca.
 * 2. Que `retries: 0` sea cero de verdad: el chat y las subidas no se pueden
 *    mandar dos veces solos (un 502 durante un despliegue arrancaba otra ronda).
 * 3. Que un corte pedido por quien llama no se disfrace de «se agotó el tiempo».
 */

/** Un fetch que no contesta nunca: sólo termina si le abortan la señal. */
function colgado(): PedidoConReintentos['fetch'] {
  return (_url, init) =>
    new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => {
        const error = new Error('The operation was aborted.');
        error.name = 'AbortError';
        reject(error);
      });
    });
}

function pedido(fetch: PedidoConReintentos['fetch'], cambios: Partial<PedidoConReintentos> = {}): PedidoConReintentos {
  return {
    fetch,
    url: 'http://localhost/proxy/agent/chat',
    init: { method: 'POST' },
    timeout: 40,
    retries: 0,
    retryDelay: 1,
    onResponse: () => {},
    onAuthError: () => {},
    onNetworkError: () => {},
    ...cambios
  };
}

describe('el reloj de cada pedido', () => {
  it('sin cabeceras a tiempo, corta con un 408', async () => {
    const error = await pedirConReintentos(pedido(colgado())).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(408);
    expect((error as ApiError).message).toBe(MENSAJE_DE_TIEMPO_AGOTADO);
  });

  it(
    'el reintento después de un 5xx también tiene reloj',
    async () => {
      let llamadas = 0;
      const colgar = colgado();

      const fetch: PedidoConReintentos['fetch'] = (url, init) => {
        llamadas += 1;

        // El primero contesta enseguida con un 502; el segundo se cuelga.
        return llamadas === 1 ? Promise.resolve(new Response('', { status: 502 })) : colgar(url, init);
      };

      const error = await pedirConReintentos(pedido(fetch, { retries: 1 })).catch((e: unknown) => e);

      expect(llamadas).toBe(2);
      // Con el reloj único, este pedido quedaba esperando para siempre y el
      // test se cortaba por su propio tiempo.
      expect((error as ApiError).status).toBe(408);
    },
    2000
  );

  it('un pedido que contesta a tiempo no se corta después', async () => {
    const respuesta = await pedirConReintentos(
      pedido(() => Promise.resolve(new Response('ok', { status: 200 })), { timeout: 20 })
    );

    // Pasado el tiempo, el cuerpo sigue legible: el reloj mide hasta las cabeceras.
    await new Promise((resolve) => setTimeout(resolve, 40));

    expect(await respuesta.text()).toBe('ok');
  });

  it('un corte de quien llama no se reporta como tiempo agotado', async () => {
    const quienLlama = new AbortController();
    const promesa = pedirConReintentos(pedido(colgado(), { timeout: 5000, signal: quienLlama.signal }));

    quienLlama.abort();

    const error = await promesa.catch((e: unknown) => e);

    expect((error as Error).name).toBe('AbortError');
    expect(error).not.toBeInstanceOf(ApiError);
  });
});

describe('los reintentos', () => {
  it('con retries 0, un 5xx no se reenvía', async () => {
    let llamadas = 0;
    const fetch = () => {
      llamadas += 1;
      return Promise.resolve(new Response('', { status: 503, statusText: 'Service Unavailable' }));
    };

    const error = await pedirConReintentos(pedido(fetch, { retries: 0 })).catch((e: unknown) => e);

    expect(llamadas).toBe(1);
    expect((error as ApiError).status).toBe(503);
  });

  it('con retries 1, un 5xx se reintenta y el segundo intento puede salir bien', async () => {
    let llamadas = 0;
    const fetch = () => {
      llamadas += 1;
      return Promise.resolve(new Response('ok', { status: llamadas === 1 ? 502 : 200 }));
    };

    const respuesta = await pedirConReintentos(pedido(fetch, { retries: 1 }));

    expect(llamadas).toBe(2);
    expect(respuesta.status).toBe(200);
  });

  it('un 4xx no se reintenta y lleva el cuerpo de la API como mensaje', async () => {
    let llamadas = 0;
    const cuerpo = JSON.stringify({ success: false, error: 'Otra ronda', code: 'AGENT_ROUND_IN_PROGRESS' });
    const fetch = () => {
      llamadas += 1;
      return Promise.resolve(new Response(cuerpo, { status: 409 }));
    };

    const error = await pedirConReintentos(pedido(fetch, { retries: 3 })).catch((e: unknown) => e);

    expect(llamadas).toBe(1);
    expect((error as ApiError).status).toBe(409);
    expect((error as ApiError).message).toBe(cuerpo);
  });
});

describe('los tiempos de las llamadas de IA', () => {
  it('ninguno pasa de 90 s: Cloudflare corta a los 100', () => {
    for (const [llamada, ms] of Object.entries(AI_REQUEST_TIMEOUT)) {
      expect({ llamada, ms: ms <= AI_REQUEST_TIMEOUT_MAX }).toEqual({ llamada, ms: true });
    }

    expect(AI_REQUEST_TIMEOUT_MAX).toBeLessThanOrEqual(90_000);
  });

  it('la investigación y el chat esperan más que los 30 s de una pantalla', () => {
    expect(AI_REQUEST_TIMEOUT.research).toBe(90_000);
    expect(AI_REQUEST_TIMEOUT.chat).toBe(90_000);
    expect(AI_REQUEST_TIMEOUT.webPage).toBe(45_000);
    expect(AI_REQUEST_TIMEOUT.image).toBe(60_000);
    expect(AI_REQUEST_TIMEOUT.summary).toBe(60_000);
  });

  it('las opciones de una llamada de IA piden su reloj y cero reintentos', () => {
    expect(llamadaDeIA(AI_REQUEST_TIMEOUT.webPage)).toEqual({ init: { timeout: 45_000, retries: 0 } });
    // Y nunca más que el techo, aunque alguien pida de más.
    expect(llamadaDeIA(300_000)).toEqual({ init: { timeout: 90_000, retries: 0 } });
  });

  it('las mismas opciones para `apiClient.request` (subidas, investigación, el chat)', () => {
    expect(opcionesDeIA(AI_REQUEST_TIMEOUT.upload)).toEqual({ timeout: 90_000, retries: 0 });
    expect(opcionesDeIA(300_000)).toEqual({ timeout: 90_000, retries: 0 });
  });
});
