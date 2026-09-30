import { stepCountIs, streamText, tool, type UIMessage } from 'ai';
import { MockLanguageModelV4, simulateReadableStream } from 'ai/test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as z from 'zod';

import {
  cerrarHerramientasColgadas,
  HERRAMIENTA_SIN_TERMINAR,
  responderRonda,
  type CandadoDeRonda
} from '@api/services/agent/ronda-viva';

import { hasta, leerPartes } from './ayuda/sse';

/**
 * La ronda del chat vista desde el servidor: late, termina aunque el navegador
 * se vaya, y se guarda entera.
 *
 * ── Lo que se midió (2026-09-29) ─────────────────────────────────────────────
 *
 * 1. Una ronda de construcción se cortó a los 121 s de silencio mientras
 *    `write_lesson` trabajaba: la respuesta no mandaba nada durante una
 *    herramienta y el proxy de adelante corta a los 120 s.
 * 2. Cortada la conexión, la ronda quedó colgada entre dos pasos: la respuesta
 *    leía una rama de un `tee` y, cancelada esa rama, nadie más tiraba del
 *    stream. Ni `onFinish`, ni consumo registrado, ni conversación guardada.
 *
 * Esto arma la ronda con un `streamText` de verdad y un modelo simulado —el
 * mismo objeto que la ruta le pasa a `responderRonda`— y lee la respuesta HTTP
 * como la lee el navegador: SSE.
 */

const esperar = (ms: number) => new Promise((resolver) => setTimeout(resolver, ms));

function uso(entrada: number, salida: number) {
  return {
    inputTokens: { total: entrada, noCache: entrada, cacheRead: undefined, cacheWrite: undefined },
    outputTokens: { total: salida, text: salida, reasoning: undefined }
  };
}

const TEXTO_FINAL = 'Listo: escribí la lección de prueba.';

/** Paso 1: pide la herramienta. Paso 2: contesta. Como una ronda chica de construcción. */
function modeloDeDosPasos() {
  let paso = 0;

  return new MockLanguageModelV4({
    doStream: async () => {
      paso += 1;

      const chunks =
        paso === 1
          ? [
              { type: 'stream-start' as const, warnings: [] },
              {
                type: 'tool-call' as const,
                toolCallId: 'llamada-1',
                toolName: 'escribir_leccion',
                input: JSON.stringify({ titulo: 'Lección de prueba' })
              },
              { type: 'finish' as const, finishReason: { unified: 'tool-calls' as const, raw: 'tool_use' }, usage: uso(100, 10) }
            ]
          : [
              { type: 'stream-start' as const, warnings: [] },
              { type: 'text-start' as const, id: 't1' },
              { type: 'text-delta' as const, id: 't1', delta: TEXTO_FINAL },
              { type: 'text-end' as const, id: 't1' },
              { type: 'finish' as const, finishReason: { unified: 'stop' as const, raw: 'stop' }, usage: uso(200, 20) }
            ];

      return { stream: simulateReadableStream({ chunks }) };
    }
  });
}

function rondaDePrueba(opciones: {
  herramientaMs: number;
  onStepFinish?: (paso: { usage?: { inputTokens?: number } }) => Promise<void> | void;
  onFinish?: () => Promise<void> | void;
}) {
  return streamText({
    model: modeloDeDosPasos(),
    prompt: 'Escribí la lección de prueba.',
    maxRetries: 0,
    stopWhen: stepCountIs(5),
    tools: {
      escribir_leccion: tool({
        inputSchema: z.object({ titulo: z.string() }),
        execute: async () => {
          await esperar(opciones.herramientaMs);

          return { escrita: true };
        }
      })
    },
    onStepFinish: opciones.onStepFinish,
    onFinish: opciones.onFinish
  });
}

const PEDIDO: UIMessage[] = [
  { id: 'mensaje-docente-1', role: 'user', parts: [{ type: 'text', text: 'Escribí la lección de prueba.' }] }
];

/** Un candado de mentira que anota cuándo se soltó. */
function candadoQueAnota(orden: string[]): CandadoDeRonda & { soltar: ReturnType<typeof vi.fn> } {
  return {
    conversationId: 'conversacion-de-prueba',
    startedAt: '2026-09-29T15:00:00.000Z',
    renovar: async () => {},
    soltar: vi.fn(async () => {
      orden.push('soltar');
    })
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('el latido', () => {
  it('sale mientras una herramienta tarda, y la respuesta no queda muda', async () => {
    const respuesta = responderRonda({
      resultado: rondaDePrueba({ herramientaMs: 150 }),
      mensajesOriginales: PEDIDO,
      onError: () => 'error',
      messageMetadata: () => undefined,
      latidoMs: 20
    });

    const { partes } = await leerPartes(respuesta);
    const tipos = partes.map((parte) => parte.type);
    const pidioLaHerramienta = tipos.indexOf('tool-input-available');
    const terminoLaHerramienta = tipos.indexOf('tool-output-available');

    expect(pidioLaHerramienta).toBeGreaterThanOrEqual(0);
    expect(terminoLaHerramienta).toBeGreaterThan(pidioLaHerramienta);

    // 150 ms de herramienta con un latido cada 20: varios en el medio.
    const latidosDuranteLaHerramienta = partes
      .slice(pidioLaHerramienta, terminoLaHerramienta)
      .filter((parte) => parte.type === 'data-latido');

    expect(latidosDuranteLaHerramienta.length).toBeGreaterThanOrEqual(3);
    // Con la forma del contrato: transitoria, para que el cliente no la guarde.
    expect(latidosDuranteLaHerramienta[0]).toEqual({ type: 'data-latido', data: {}, transient: true });
  });

  it('el intervalo se limpia cuando la ronda termina', async () => {
    const creados: unknown[] = [];
    const limpiados = new Set<unknown>();
    const setIntervalReal = globalThis.setInterval;
    const clearIntervalReal = globalThis.clearInterval;

    vi.spyOn(globalThis, 'setInterval').mockImplementation(((...args: Parameters<typeof setInterval>) => {
      const id = setIntervalReal(...args);
      creados.push(id);
      return id;
    }) as typeof setInterval);
    vi.spyOn(globalThis, 'clearInterval').mockImplementation(((id: Parameters<typeof clearInterval>[0]) => {
      limpiados.add(id);
      clearIntervalReal(id);
    }) as typeof clearInterval);

    const respuesta = responderRonda({
      resultado: rondaDePrueba({ herramientaMs: 30 }),
      mensajesOriginales: PEDIDO,
      onError: () => 'error',
      messageMetadata: () => undefined,
      latidoMs: 10
    });

    await leerPartes(respuesta);

    expect(creados.length).toBeGreaterThan(0);
    expect(creados.every((id) => limpiados.has(id))).toBe(true);
  });
});

describe('si el navegador se va, la ronda termina igual', () => {
  it('corre el resto de los pasos, cierra, guarda el mensaje completo y suelta el candado después', async () => {
    const orden: string[] = [];
    const usos: Array<number | undefined> = [];
    let terminoLaRonda = false;
    const guardados: UIMessage[][] = [];
    const candado = candadoQueAnota(orden);

    const respuesta = responderRonda({
      resultado: rondaDePrueba({
        herramientaMs: 60,
        onStepFinish: (paso) => {
          usos.push(paso.usage?.inputTokens);
        },
        onFinish: () => {
          terminoLaRonda = true;
          orden.push('onFinish');
        }
      }),
      mensajesOriginales: PEDIDO,
      onError: () => 'error',
      messageMetadata: ({ part }) => (part.type === 'finish' ? { cerrada: true } : undefined),
      guardar: async (mensajes) => {
        orden.push('guardar');
        guardados.push(mensajes);
      },
      candado,
      latidoMs: 1_000
    });

    // El navegador lee hasta que arranca la herramienta y se va: una recarga,
    // un cambio de empresa, el proxy que corta.
    const { partes, lector } = await leerPartes(respuesta, (parte) => parte.type !== 'tool-input-available');
    await lector.cancel();

    const inicio = partes.find((parte) => parte.type === 'start');
    expect(inicio?.messageId).toEqual(expect.any(String));

    await hasta(() => candado.soltar.mock.calls.length > 0);

    // Los DOS pasos corrieron y se vieron: el segundo arrancó sin nadie leyendo.
    expect(usos).toEqual([100, 200]);
    expect(terminoLaRonda).toBe(true);

    // Primero el cierre de la ronda, después el guardado, al final el candado:
    // quien espera que la ronda deje de estar viva encuentra lo guardado.
    expect(orden).toEqual(['onFinish', 'guardar', 'soltar']);

    expect(guardados).toHaveLength(1);
    const [conversacion] = guardados;
    expect(conversacion).toHaveLength(2);
    expect(conversacion[0]).toEqual(PEDIDO[0]);

    const respuestaGuardada = conversacion[1];
    // El mismo id que el navegador recibió en la parte `start`: así el panel
    // que recarga la conversación reconoce su mensaje.
    expect(respuestaGuardada.id).toBe(inicio?.messageId);
    expect(respuestaGuardada.role).toBe('assistant');
    expect(respuestaGuardada.metadata).toEqual({ cerrada: true });

    const herramienta = respuestaGuardada.parts.find((parte) => parte.type === 'tool-escribir_leccion') as
      | { state?: string; output?: unknown }
      | undefined;
    expect(herramienta?.state).toBe('output-available');
    expect(herramienta?.output).toEqual({ escrita: true });

    const texto = respuestaGuardada.parts
      .filter((parte): parte is { type: 'text'; text: string } => parte.type === 'text')
      .map((parte) => parte.text)
      .join('');
    expect(texto).toBe(TEXTO_FINAL);
  });

  it('con el navegador conectado, lo guardado es lo mismo que recibió', async () => {
    const guardados: UIMessage[][] = [];

    const respuesta = responderRonda({
      resultado: rondaDePrueba({ herramientaMs: 5 }),
      mensajesOriginales: PEDIDO,
      onError: () => 'error',
      messageMetadata: () => undefined,
      guardar: async (mensajes) => {
        guardados.push(mensajes);
      },
      latidoMs: 1_000
    });

    const { partes } = await leerPartes(respuesta);

    expect(partes.at(-1)?.type).toBe('finish');
    expect(guardados).toHaveLength(1);
    expect(guardados[0][1].id).toBe(partes.find((parte) => parte.type === 'start')?.messageId);
  });

  it('sin conversación no guarda nada, y la ronda cierra igual', async () => {
    const respuesta = responderRonda({
      resultado: rondaDePrueba({ herramientaMs: 5 }),
      mensajesOriginales: PEDIDO,
      onError: () => 'error',
      messageMetadata: () => undefined,
      latidoMs: 1_000
    });

    const { partes } = await leerPartes(respuesta);

    expect(partes.at(-1)?.type).toBe('finish');
  });
});

describe('cuando la ronda falla', () => {
  function modeloQueFalla() {
    return new MockLanguageModelV4({
      doStream: async () => {
        throw new Error('el proveedor no contestó');
      }
    });
  }

  it('sin nada escrito guarda sólo lo que mandó el cliente, no una burbuja vacía, y suelta el candado', async () => {
    const orden: string[] = [];
    const guardados: UIMessage[][] = [];
    const candado = candadoQueAnota(orden);

    const respuesta = responderRonda({
      resultado: streamText({ model: modeloQueFalla(), prompt: 'hola', maxRetries: 0, onError: () => {} }),
      mensajesOriginales: PEDIDO,
      onError: () => 'Error del agente: el proveedor no contestó',
      messageMetadata: () => undefined,
      guardar: async (mensajes) => {
        orden.push('guardar');
        guardados.push(mensajes);
      },
      candado,
      latidoMs: 1_000
    });

    const { partes } = await leerPartes(respuesta);

    expect(partes.some((parte) => parte.type === 'error')).toBe(true);
    expect(guardados).toEqual([PEDIDO]);
    expect(orden).toEqual(['guardar', 'soltar']);
  });
});

describe('las herramientas que quedaron sin resultado', () => {
  const mensajes: UIMessage[] = [
    { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'Construí el curso según el plan aprobado.' }] },
    {
      id: 'a1',
      role: 'assistant',
      parts: [
        {
          type: 'tool-get_course_structure',
          toolCallId: 'c1',
          state: 'output-available',
          input: {},
          output: { ok: true }
        },
        { type: 'tool-write_lesson', toolCallId: 'c2', state: 'input-available', input: { title: 'Lección 1.1' } },
        { type: 'tool-write_lesson', toolCallId: 'c3', state: 'input-streaming', input: undefined }
      ]
    } as UIMessage
  ];

  it('se cierran con un error que le dice al docente qué pasó', () => {
    const [docente, asistente] = cerrarHerramientasColgadas(mensajes);
    const estados = asistente.parts.map((parte) => (parte as { state?: string }).state);

    expect(docente).toBe(mensajes[0]);
    expect(estados).toEqual(['output-available', 'output-error', 'output-error']);
    expect((asistente.parts[1] as { errorText?: string }).errorText).toBe(HERRAMIENTA_SIN_TERMINAR);
  });

  it('un mensaje sin herramientas colgadas queda como estaba', () => {
    const limpio = [mensajes[0], { ...mensajes[1], parts: [mensajes[1].parts[0]] }];

    expect(cerrarHerramientasColgadas(limpio)[1]).toBe(limpio[1]);
  });
});
