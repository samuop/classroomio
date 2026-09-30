import { ApiError } from '$lib/utils/services/api/types';

import {
  cerrarHerramientasColgadas,
  clasificarFinDeRonda,
  conversacionTrasLaRonda,
  esperarFinDeRonda,
  hayQueEsperarAlServidor,
  laLocalTieneMasQueElServidor,
  laRecargaResuelveElError,
  rondaVivaDe,
  type DatosDelFin
} from './ronda-cortada';

/**
 * Lo que hace el panel cuando una ronda no termina limpia (contrato C3).
 *
 * ── El caso medido (forma real, datos inventados) ────────────────────────────
 *
 * El stream se cortó a los 121 s mientras el servidor escribía una lección. El
 * panel guardó la conversación con esa herramienta «trabajando» y sin metadata,
 * y el chat quedó congelado ahí aunque el servidor siguió y construyó ocho
 * piezas más. Ahora el servidor termina la ronda y guarda él; el panel no guarda
 * nada a medias, cierra lo colgado y recarga lo guardado.
 */

const fin = (cambios: Partial<DatosDelFin>): DatosDelFin => ({
  isAbort: false,
  isDisconnect: false,
  isError: false,
  finishReason: 'stop',
  respuestaIniciada: true,
  ...cambios
});

describe('cómo terminó la ronda', () => {
  it('con la parte `finish`, completa', () => {
    expect(clasificarFinDeRonda(fin({}))).toBe('completa');
  });

  it('«Detener» es una detención, aunque también corte el stream', () => {
    expect(clasificarFinDeRonda(fin({ isAbort: true, finishReason: undefined }))).toBe('detenida');
  });

  it('un error de red DESPUÉS de las cabeceras es un corte, lo escriba como lo escriba el navegador', () => {
    // El SDK sólo marca `isDisconnect` si el texto dice «fetch» o «network».
    // Safari dice «Load failed»: sin mirar las cabeceras, eso era un fallo más.
    expect(clasificarFinDeRonda(fin({ isError: true, error: new TypeError('Load failed'), finishReason: undefined }))).toBe(
      'cortada'
    );
    expect(
      clasificarFinDeRonda(fin({ isError: true, isDisconnect: true, error: new TypeError('network error') }))
    ).toBe('cortada');
  });

  it('un stream que se cierra sin la parte `finish` también es un corte, aunque no traiga error', () => {
    expect(clasificarFinDeRonda(fin({ finishReason: undefined }))).toBe('cortada');
  });

  it('un error ANTES de las cabeceras es un fallo: el turno quizá ni llegó', () => {
    const vencido = new ApiError('Request timeout', 408, 'Request Timeout');

    expect(clasificarFinDeRonda(fin({ isError: true, error: vencido, respuestaIniciada: false }))).toBe('fallida');
  });

  it('un error que manda el servidor en el stream es un fallo, no un corte', () => {
    expect(clasificarFinDeRonda(fin({ isError: true, error: new Error('The model is overloaded') }))).toBe('fallida');
  });

  it('el 409 de una conversación con otra ronda viva es un rechazo', () => {
    const rechazo = new ApiError(
      JSON.stringify({
        success: false,
        error: 'A round is already running for this conversation',
        code: 'AGENT_ROUND_IN_PROGRESS'
      }),
      409,
      'Conflict'
    );

    expect(clasificarFinDeRonda(fin({ isError: true, error: rechazo, respuestaIniciada: false }))).toBe('rechazada');
  });
});

describe('las herramientas que quedaron colgadas', () => {
  const colgado = [
    { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hola' }] },
    {
      id: 'a1',
      role: 'assistant',
      parts: [
        { type: 'tool-create_section', toolCallId: 't1', state: 'output-available', output: { ok: true } },
        { type: 'tool-write_lesson', toolCallId: 't2', state: 'input-available', input: { title: 'Arqueo' } },
        { type: 'tool-write_questions', toolCallId: 't3', state: 'input-streaming' },
        { type: 'dynamic-tool', toolCallId: 't4', state: 'input-available' },
        { type: 'text', text: 'Escribiendo…' }
      ]
    }
  ];

  it('se cierran como interrumpidas, con el texto que les pasen', () => {
    const cerrado = cerrarHerramientasColgadas(colgado, 'Se cortó antes de terminar.');
    const partes = cerrado[1].parts as Array<{ state?: string; errorText?: string; type: string }>;

    expect(partes[1]).toMatchObject({ state: 'output-error', errorText: 'Se cortó antes de terminar.' });
    expect(partes[2]).toMatchObject({ state: 'output-error' });
    expect(partes[3]).toMatchObject({ state: 'output-error' });
  });

  it('lo que ya tenía resultado, el texto y los mensajes del docente no se tocan', () => {
    const cerrado = cerrarHerramientasColgadas(colgado, 'x');
    const partes = cerrado[1].parts as Array<Record<string, unknown>>;

    expect(partes[0]).toBe(colgado[1].parts[0]);
    expect(partes[4]).toBe(colgado[1].parts[4]);
    expect(cerrado[0]).toBe(colgado[0]);
    // Conserva lo que sabía de la llamada: el paso se sigue pudiendo nombrar.
    expect(partes[1]).toMatchObject({ toolCallId: 't2', input: { title: 'Arqueo' } });
  });

  it('sin nada colgado devuelve el mismo arreglo, para no reasignar por nada', () => {
    const limpio = [colgado[0]];

    expect(cerrarHerramientasColgadas(limpio, 'x')).toBe(limpio);
  });
});

describe('la conversación después de esperar a la ronda', () => {
  const u1 = { id: 'u1', role: 'user', parts: [{ type: 'text' }] };
  const a1 = { id: 'a1', role: 'assistant', parts: [{ type: 'text' }] };
  const u2 = { id: 'u2', role: 'user', parts: [{ type: 'text' }] };
  const a2Cortado = { id: 'a2', role: 'assistant', parts: [{ type: 'tool-write_lesson', state: 'input-available' }] };
  const a2Completo = { id: 'a2', role: 'assistant', parts: [{ type: 'tool-write_lesson' }, { type: 'text' }] };

  it('si lo guardado trae una respuesta después del último mensaje del docente, gana lo guardado', () => {
    const servidor = [u1, a1, u2, a2Completo];

    expect(conversacionTrasLaRonda([u1, a1, u2, a2Cortado], servidor)).toBe(servidor);
  });

  it('si no trae el mensaje del docente, el turno nunca corrió: se queda la local, con el mensaje para reintentar', () => {
    const local = [u1, a1, u2];

    expect(conversacionTrasLaRonda(local, [u1, a1])).toBe(local);
  });

  it('el pedido que el servidor guardó al aceptarlo, sin respuesta, no es el turno: la banda de error se queda', () => {
    // El servidor guarda el pedido apenas lo acepta. Una ronda que después
    // falló deja eso guardado, y tomarlo por «el turno completo» borraba el
    // error y el «Reintentar».
    const local = [u1, a1, u2];

    expect(conversacionTrasLaRonda(local, [u1, a1, u2])).toBe(local);
  });

  it('un reinicio del servidor a mitad de ronda no borra la respuesta a medias que la pantalla ya mostraba', () => {
    const local = [u1, a1, u2, a2Cortado];

    expect(conversacionTrasLaRonda(local, [u1, a1, u2])).toBe(local);
  });

  it('si el servidor no guardó la respuesta a medias, la local tiene más: hay que guardarla', () => {
    expect(laLocalTieneMasQueElServidor([u1, a1, u2, a2Cortado], [u1, a1, u2])).toBe(true);
    // Con el turno completo en el servidor, no; sin respuesta local, tampoco.
    expect(laLocalTieneMasQueElServidor([u1, a1, u2, a2Cortado], [u1, a1, u2, a2Completo])).toBe(false);
    expect(laLocalTieneMasQueElServidor([u1, a1, u2], [u1, a1, u2])).toBe(false);
  });

  it('una respuesta guardada sin partes tampoco cuenta como turno', () => {
    const local = [u1, a1, u2, a2Cortado];

    expect(conversacionTrasLaRonda(local, [u1, a1, u2, { id: 'a2', role: 'assistant', parts: [] }])).toBe(local);
  });

  it('sin nada guardado, se queda la local', () => {
    const local = [u1];

    expect(conversacionTrasLaRonda(local, [])).toBe(local);
    expect(conversacionTrasLaRonda(local, null)).toBe(local);
  });

  it('una local sin mensajes del docente toma lo guardado', () => {
    const servidor = [u1, a1];

    expect(conversacionTrasLaRonda([], servidor)).toBe(servidor);
  });
});

describe('después de una ronda que no terminó limpia', () => {
  const vencido = new ApiError('Request timeout', 408, 'Request Timeout');
  const sinCupo = new ApiError('{"success":false,"code":"AI_CREDITS_EXHAUSTED"}', 402, 'Payment Required');

  it('un error con estado antes de las cabeceras es la respuesta del servidor: no hay ronda que esperar', () => {
    expect(hayQueEsperarAlServidor('fallida', { respuestaIniciada: false, error: sinCupo })).toBe(false);
  });

  it('el reloj del navegador que vence no es respuesta del servidor: la ronda siguió y se espera', () => {
    expect(hayQueEsperarAlServidor('fallida', { respuestaIniciada: false, error: vencido })).toBe(true);
  });

  it('un corte, una detención o un rechazo se esperan; un final completo no', () => {
    expect(hayQueEsperarAlServidor('cortada', { respuestaIniciada: true })).toBe(true);
    expect(hayQueEsperarAlServidor('detenida', { respuestaIniciada: true })).toBe(true);
    expect(hayQueEsperarAlServidor('rechazada', { respuestaIniciada: false })).toBe(true);
    expect(hayQueEsperarAlServidor('completa', { respuestaIniciada: true })).toBe(false);
  });

  it('la recarga saca la banda sólo si el error era del camino, no de la ronda', () => {
    expect(laRecargaResuelveElError('cortada', new TypeError('network error'))).toBe(true);
    expect(laRecargaResuelveElError('fallida', vencido)).toBe(true);
    // El proveedor falló a mitad de ronda: lo guardado trae lo hecho, pero el
    // error sigue siendo cierto y se queda con su «Reintentar».
    expect(laRecargaResuelveElError('fallida', new Error('Error del agente: overloaded'))).toBe(false);
  });
});

describe('la ronda viva que informa el estado', () => {
  it('la lee cuando viene', () => {
    expect(rondaVivaDe({ activeRound: { conversationId: 'c1', startedAt: '2026-09-29T18:00:00.000Z' } })).toEqual({
      conversationId: 'c1',
      startedAt: '2026-09-29T18:00:00.000Z'
    });
  });

  it('null, ausente o mal formada es «no hay»: el chat no se traba por un dato que no está', () => {
    expect(rondaVivaDe({ activeRound: null })).toBeNull();
    expect(rondaVivaDe({ role: 'teacher' })).toBeNull();
    expect(rondaVivaDe({ activeRound: { startedAt: 'x' } })).toBeNull();
    expect(rondaVivaDe(null)).toBeNull();
  });
});

describe('esperar a que la ronda termine', () => {
  const sinDormir = () => Promise.resolve();

  it('sin ronda viva termina en la primera pregunta, sin esperar', async () => {
    const dormir = vi.fn(sinDormir);
    const resultado = await esperarFinDeRonda({ conversationId: 'c1', leerRondaViva: async () => null, dormir });

    expect(resultado).toBe('terminada');
    expect(dormir).not.toHaveBeenCalled();
  });

  it('espera mientras la ronda de ESTA conversación sigue viva', async () => {
    const respuestas = [
      { conversationId: 'c1', startedAt: 'x' },
      { conversationId: 'c1', startedAt: 'x' },
      null
    ];
    const vivas: number[] = [];

    const resultado = await esperarFinDeRonda({
      conversationId: 'c1',
      leerRondaViva: async () => respuestas.shift() ?? null,
      alSeguirViva: (vuelta) => vivas.push(vuelta),
      dormir: sinDormir
    });

    expect(resultado).toBe('terminada');
    expect(vivas).toEqual([1, 2]);
  });

  it('la ronda de OTRA conversación no es la que se espera', async () => {
    const resultado = await esperarFinDeRonda({
      conversationId: 'c1',
      leerRondaViva: async () => ({ conversationId: 'c2', startedAt: 'x' }),
      dormir: sinDormir
    });

    expect(resultado).toBe('terminada');
  });

  it('sin poder saber, sigue esperando sólo si ya la había visto viva', async () => {
    // Nunca vista: no se traba el chat por una ronda que nadie confirmó. Se
    // termina en la PRIMERA pregunta, no al agotar la espera.
    const sinSaber = vi.fn(async () => undefined);

    expect(await esperarFinDeRonda({ conversationId: 'c1', leerRondaViva: sinSaber, dormir: sinDormir })).toBe(
      'terminada'
    );
    expect(sinSaber).toHaveBeenCalledTimes(1);

    // Vista viva y después un error de red: se sigue esperando.
    const respuestas = [{ conversationId: 'c1', startedAt: 'x' }, undefined, undefined, null];
    let vuelta = 0;
    const leer = vi.fn(async () => (vuelta < respuestas.length ? respuestas[vuelta++] : null));

    expect(await esperarFinDeRonda({ conversationId: 'c1', leerRondaViva: leer, dormir: sinDormir })).toBe(
      'terminada'
    );
    expect(leer).toHaveBeenCalledTimes(4);
  });

  it('se corta si quien espera se fue', async () => {
    let fuera = false;

    const resultado = await esperarFinDeRonda({
      conversationId: 'c1',
      leerRondaViva: async () => {
        fuera = true;
        return { conversationId: 'c1', startedAt: 'x' };
      },
      cancelada: () => fuera,
      dormir: sinDormir
    });

    expect(resultado).toBe('cancelada');
  });

  it('no espera para siempre', async () => {
    const leer = vi.fn(async () => ({ conversationId: 'c1', startedAt: 'x' }));

    const resultado = await esperarFinDeRonda({
      conversationId: 'c1',
      leerRondaViva: leer,
      dormir: sinDormir,
      maximoDeVueltas: 3
    });

    expect(resultado).toBe('terminada');
    expect(leer).toHaveBeenCalledTimes(4);
  });
});
