import { Chat } from '@ai-sdk/svelte';
import { DefaultChatTransport, type UIMessage } from 'ai';

import { ApiError } from '$lib/utils/services/api/types';
import { TEXTO_DE_APROBACION } from './mensajes-de-control';
import { clasificarFinDeRonda } from './ronda-cortada';

/**
 * El chat del SDK tal como lo arma el panel: `Chat` con `DefaultChatTransport`
 * y un `fetch` propio. Lo único falso es la red.
 *
 * ── Qué se fija ──────────────────────────────────────────────────────────────
 *
 * 1. El latido (contrato C1): el servidor manda cada 20 s una parte
 *    `data-latido` transitoria para que ningún proxy corte una ronda callada.
 *    El SDK tiene que aceptarla (pasa su esquema) y NO guardarla en el mensaje.
 * 2. «Reintentar» usa `regenerate()`: tiene que reenviar el MISMO mensaje del
 *    docente —texto, id y `metadata.plan`— sin agregar una copia. Medido antes:
 *    reintentar después de aprobar reenviaba la descripción original del curso.
 * 3. Las señales con las que el panel clasifica el fin de una ronda: una ronda
 *    completa trae `finishReason`; un stream que se cierra sin la parte
 *    `finish`, no.
 */

const sse = (partes: unknown[], { cerrar = true }: { cerrar?: boolean } = {}) =>
  partes.map((parte) => `data: ${JSON.stringify(parte)}\n\n`).join('') + (cerrar ? 'data: [DONE]\n\n' : '');

const respuestaSse = (cuerpo: string) =>
  new Response(cuerpo, { status: 200, headers: { 'content-type': 'text/event-stream' } });

const latido = { type: 'data-latido', data: {}, transient: true };

const ronda = (texto: string) => [
  { type: 'start', messageId: 'resp-1' },
  latido,
  { type: 'start-step' },
  { type: 'text-start', id: 't1' },
  { type: 'text-delta', id: 't1', delta: texto },
  latido,
  { type: 'text-end', id: 't1' },
  { type: 'finish-step' },
  { type: 'finish', finishReason: 'stop' }
];

interface Fin {
  isAbort: boolean;
  isDisconnect: boolean;
  isError: boolean;
  finishReason?: string;
}

function armarChat(respuestas: Array<() => Promise<Response>>) {
  const pedidos: Array<{ trigger: string; messages: UIMessage[] }> = [];
  const fines: Fin[] = [];
  let respuestaIniciada = false;

  const chat = new Chat({
    id: 'prueba',
    transport: new DefaultChatTransport({
      api: 'http://localhost/proxy/agent/chat',
      fetch: async (_input, init) => {
        respuestaIniciada = false;
        pedidos.push(JSON.parse(String(init?.body)));

        const siguiente = respuestas.shift();

        if (!siguiente) throw new Error('no hay más respuestas');

        const respuesta = await siguiente();
        respuestaIniciada = true;

        return respuesta;
      }
    }),
    onFinish: ({ isAbort, isDisconnect, isError, finishReason }) => {
      fines.push({ isAbort, isDisconnect, isError, finishReason });
    }
  });

  return { chat, pedidos, fines, iniciada: () => respuestaIniciada };
}

describe('el latido del servidor', () => {
  it('pasa el esquema del SDK y no queda en el mensaje', async () => {
    const { chat, fines } = armarChat([async () => respuestaSse(sse(ronda('Listo.')))]);

    await chat.sendMessage({ text: 'hola' });

    const respuesta = chat.messages.at(-1)!;

    expect(chat.status).toBe('ready');
    expect(respuesta.role).toBe('assistant');
    expect(respuesta.parts.some((parte) => parte.type === 'data-latido')).toBe(false);
    expect(respuesta.parts.some((parte) => parte.type === 'text' && parte.text === 'Listo.')).toBe(true);
    // El id de la respuesta es el de la parte `start`: el mismo que guarda el servidor.
    expect(respuesta.id).toBe('resp-1');
    expect(fines).toEqual([{ isAbort: false, isDisconnect: false, isError: false, finishReason: 'stop' }]);
  });

  it('una ronda que por ahora sólo late sigue en «enviado», sin un mensaje vacío del asistente', async () => {
    const codificador = new TextEncoder();
    let empujar: (texto: string) => void = () => {};
    let cerrar: () => void = () => {};
    const cuerpo = new ReadableStream<Uint8Array>({
      start(controller) {
        empujar = (texto) => controller.enqueue(codificador.encode(texto));
        cerrar = () => controller.close();
      }
    });
    const { chat, pedidos } = armarChat([
      async () => new Response(cuerpo, { status: 200, headers: { 'content-type': 'text/event-stream' } })
    ]);

    const envio = chat.sendMessage({ text: 'hola' });

    await vi.waitFor(() => expect(pedidos).toHaveLength(1));
    empujar(sse([latido, latido], { cerrar: false }));
    await new Promise((resolver) => setTimeout(resolver, 20));

    // El servidor está vivo y todavía no contestó nada: nada que dibujar.
    expect(chat.status).toBe('submitted');
    expect(chat.messages.some((mensaje) => mensaje.role === 'assistant')).toBe(false);

    empujar(sse(ronda('Hecho.')));
    cerrar();
    await envio;

    expect(chat.messages.filter((mensaje) => mensaje.role === 'assistant')).toHaveLength(1);
    expect(chat.status).toBe('ready');
  });
});

describe('cómo se ve el fin de una ronda', () => {
  it('un stream que se cierra sin la parte `finish` llega sin `finishReason` y sin error: es un corte', async () => {
    const cortada = ronda('A medias').slice(0, 5);
    const { chat, fines, iniciada } = armarChat([async () => respuestaSse(sse(cortada, { cerrar: false }))]);

    await chat.sendMessage({ text: 'hola' });

    expect(fines[0]).toMatchObject({ isError: false, finishReason: undefined });
    expect(clasificarFinDeRonda({ ...fines[0], respuestaIniciada: iniciada(), error: chat.error })).toBe('cortada');
  });

  it('un error de red a mitad del stream llega como error después de las cabeceras: es un corte', async () => {
    const { chat, fines, iniciada } = armarChat([
      async () => {
        const codificador = new TextEncoder();
        const cuerpo = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(codificador.encode(sse(ronda('x').slice(0, 3), { cerrar: false })));
            controller.error(new TypeError('network error'));
          }
        });

        return new Response(cuerpo, { status: 200, headers: { 'content-type': 'text/event-stream' } });
      }
    ]);

    await chat.sendMessage({ text: 'hola' });

    expect(fines[0]).toMatchObject({ isError: true, isDisconnect: true });
    expect(clasificarFinDeRonda({ ...fines[0], respuestaIniciada: iniciada(), error: chat.error })).toBe('cortada');
  });

  it('un vencimiento antes de las cabeceras es un fallo, no un corte', async () => {
    const { chat, fines, iniciada } = armarChat([
      async () => {
        throw new ApiError('Request timeout', 408, 'Request Timeout');
      }
    ]);

    await chat.sendMessage({ text: 'hola' });

    expect(chat.status).toBe('error');
    expect(clasificarFinDeRonda({ ...fines[0], respuestaIniciada: iniciada(), error: chat.error })).toBe('fallida');
  });
});

describe('«Reintentar» con regenerate()', () => {
  const plan = { title: 'Caja en sucursales', sections: [] };

  it('reenvía la MISMA aprobación —texto, id y metadata— sin agregar una copia', async () => {
    const { chat, pedidos } = armarChat([
      async () => {
        throw new ApiError('Request timeout', 408, 'Request Timeout');
      },
      async () => respuestaSse(sse(ronda('Construyendo.')))
    ]);

    await chat.sendMessage({
      text: TEXTO_DE_APROBACION,
      metadata: { plan: { action: 'implement_course_plan', payload: plan } }
    });

    expect(chat.status).toBe('error');

    const aprobacion = chat.messages[0];

    await chat.regenerate();

    // Una sola aprobación en la conversación, y la respuesta después.
    expect(chat.messages.map((mensaje) => mensaje.role)).toEqual(['user', 'assistant']);
    expect(chat.messages[0].id).toBe(aprobacion.id);

    // Lo que viajó en el reintento: el mismo mensaje, con su marca de aprobación.
    const reintento = pedidos[1];

    expect(reintento.trigger).toBe('regenerate-message');
    expect(reintento.messages).toHaveLength(1);
    expect(reintento.messages[0]).toMatchObject({
      id: aprobacion.id,
      role: 'user',
      parts: [{ type: 'text', text: TEXTO_DE_APROBACION }],
      metadata: { plan: { action: 'implement_course_plan' } }
    });
  });

  it('con una respuesta cortada después, la saca y vuelve a pedir el turno', async () => {
    const { chat, pedidos } = armarChat([
      async () => respuestaSse(sse(ronda('A medias').slice(0, 5), { cerrar: false })),
      async () => respuestaSse(sse(ronda('Completa.')))
    ]);

    await chat.sendMessage({ text: 'Armá la sección de cierre' });
    expect(chat.messages.map((mensaje) => mensaje.role)).toEqual(['user', 'assistant']);

    await chat.regenerate();

    expect(chat.messages.map((mensaje) => mensaje.role)).toEqual(['user', 'assistant']);
    expect(pedidos[1].messages.map((mensaje) => mensaje.role)).toEqual(['user']);
    expect(chat.messages[1].parts.some((parte) => parte.type === 'text' && parte.text === 'Completa.')).toBe(true);
  });
});
