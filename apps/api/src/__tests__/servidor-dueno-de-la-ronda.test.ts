/**
 * El servidor es dueño de la conversación y de la ronda.
 *
 * ── Qué pasaba ───────────────────────────────────────────────────────────────
 *
 * - El navegador mandaba la conversación entera en cada pedido (medido: 1,4 MB
 *   por mensaje en una construcción) y los envíos se cortaban.
 * - La ronda tenía 40 pasos y la construcción seguía porque el NAVEGADOR
 *   mandaba «seguí»: cerrar la pestaña la frenaba, y cada ronda arrancaba sin
 *   memoria de la anterior.
 *
 * ── Qué se prueba ────────────────────────────────────────────────────────────
 *
 * - `historiaDeLaRonda`: las reglas que antes aplicaba el navegador sobre su
 *   copia (reintentar, reenviar, aprobación repetida).
 * - `decidirOtroTramo`: cada freno de la continuación del servidor.
 * - `responderRonda` con dos tramos de un `streamText` de verdad: llegan como
 *   UN mensaje del asistente, con un solo `start` y un solo `finish`, y se
 *   guarda así.
 */
import { streamText, type UIMessage } from 'ai';
import { MockLanguageModelV4, simulateReadableStream } from 'ai/test';
import { describe, expect, it } from 'vitest';

import { historiaDeLaRonda, mensajesGuardados } from '@api/services/agent/historia-del-servidor';
import {
  decidirOtroTramo,
  MAX_TRAMOS,
  terminaConPregunta,
  textoDeContinuacion
} from '@api/services/agent/continuacion-del-servidor';
import { responderRonda } from '@api/services/agent/ronda-viva';

import { leerPartes } from './ayuda/sse';

function texto(id: string, role: 'user' | 'assistant', contenido: string, metadata?: unknown): UIMessage {
  return { id, role, parts: [{ type: 'text', text: contenido }], ...(metadata ? { metadata } : {}) } as UIMessage;
}

const GUARDADA: UIMessage[] = [
  texto('u1', 'user', 'Armá un curso de ventas.'),
  texto('a1', 'assistant', 'Acá está el plan.'),
  texto('u2', 'user', 'Corregí la lección 2.'),
  texto('a2', 'assistant', 'Listo.')
];

describe('la historia de la ronda la arma el servidor', () => {
  it('un mensaje nuevo va al final de lo guardado', () => {
    const nuevo = texto('u3', 'user', 'Ahora la 3.');

    expect(historiaDeLaRonda({ guardada: GUARDADA, mensaje: nuevo }).map((m) => m.id)).toEqual([
      'u1',
      'a1',
      'u2',
      'a2',
      'u3'
    ]);
  });

  it('un mensaje que ya estaba (mismo id) se reemplaza y se corta lo que venía después', () => {
    const editado = texto('u2', 'user', 'Corregí la lección 2, y también el título.');
    const historia = historiaDeLaRonda({ guardada: GUARDADA, mensaje: editado });

    expect(historia.map((m) => m.id)).toEqual(['u1', 'a1', 'u2']);
    expect(historia.at(-1)).toBe(editado);
  });

  it('«Reintentar» vuelve a responder el último pedido, sin la respuesta que tuvo', () => {
    // El SDK manda el último mensaje de la docente: es el mismo id.
    expect(
      historiaDeLaRonda({ guardada: GUARDADA, mensaje: GUARDADA[2], disparo: 'regenerate-message' }).map((m) => m.id)
    ).toEqual(['u1', 'a1', 'u2']);

    // Y sin mensaje, igual: el último de la docente que haya guardado.
    expect(historiaDeLaRonda({ guardada: GUARDADA, disparo: 'regenerate-message' }).map((m) => m.id)).toEqual([
      'u1',
      'a1',
      'u2'
    ]);
  });

  it('una aprobación nueva reemplaza a la anterior que quedó sin respuesta', () => {
    const aprobacion = (id: string) =>
      texto(id, 'user', 'Construí el curso según el plan aprobado.', { plan: { action: 'implement_course_plan' } });
    const conAprobacionMuda = [...GUARDADA.slice(0, 2), aprobacion('ap1')];

    expect(historiaDeLaRonda({ guardada: conAprobacionMuda, mensaje: aprobacion('ap2') }).map((m) => m.id)).toEqual([
      'u1',
      'a1',
      'ap2'
    ]);

    // Una aprobación que SÍ tuvo respuesta queda en la historia.
    const conRespuesta = [...conAprobacionMuda, texto('a9', 'assistant', 'Construido.')];

    expect(historiaDeLaRonda({ guardada: conRespuesta, mensaje: aprobacion('ap2') }).map((m) => m.id)).toEqual([
      'u1',
      'a1',
      'ap1',
      'a9',
      'ap2'
    ]);
  });

  it('sin nada guardado, el mensaje solo; y lo guardado que no es lista cuenta como vacío', () => {
    const primero = texto('u1', 'user', 'Hola');

    expect(historiaDeLaRonda({ guardada: [], mensaje: primero })).toEqual([primero]);
    expect(mensajesGuardados(null)).toEqual([]);
    expect(mensajesGuardados({ no: 'lista' })).toEqual([]);
    expect(mensajesGuardados([primero, 'basura', null])).toEqual([primero]);
  });
});

describe('cuándo el servidor sigue construyendo solo', () => {
  const BASE = {
    esConstruccion: true,
    planPendiente: { pendingCount: 3, emptyCount: 0 },
    detenida: false,
    sinCupo: false,
    finishReason: 'stop',
    pasosTotales: 30,
    maxPasos: 250,
    escriturasDelTramo: 4,
    tramo: 1,
    textoFinal: 'Escribí las lecciones 1 a 4.'
  };

  it('sigue si el plan está a medias, el tramo avanzó y el modelo cerró normal', () => {
    expect(decidirOtroTramo(BASE)).toEqual({ seguir: true });
  });

  it.each([
    [{ esConstruccion: false }, 'no_es_construccion'],
    [{ planPendiente: { pendingCount: 0, emptyCount: 0 } }, 'plan_completo'],
    [{ planPendiente: undefined }, 'plan_completo'],
    [{ detenida: true }, 'detenida'],
    [{ sinCupo: true }, 'sin_cupo'],
    [{ pasosTotales: 250 }, 'techo_de_pasos'],
    [{ finishReason: 'error' }, 'no_termino_bien'],
    [{ finishReason: 'length' }, 'no_termino_bien'],
    [{ textoFinal: 'Falta la sección 3. ¿Querés que la arme con el manual nuevo?' }, 'pregunta_a_la_docente'],
    [{ escriturasDelTramo: 0 }, 'sin_avance'],
    [{ tramo: MAX_TRAMOS }, 'tope_de_tramos']
  ] as const)('no sigue con %o → %s', (cambio, motivo) => {
    expect(decidirOtroTramo({ ...BASE, ...cambio })).toEqual({ seguir: false, motivo });
  });

  it('una pregunta en el medio del resumen no frena; una al final sí, con o sin formato', () => {
    expect(terminaConPregunta('¿Qué es un presupuesto? Lo expliqué en la lección 2. Listo.')).toBe(false);
    expect(terminaConPregunta('¿Sigo con la sección 3?**')).toBe(true);
    expect(terminaConPregunta('Decime: «¿uso el manual nuevo?»')).toBe(true);
  });

  it('la orden del tramo nuevo dice cuánto falta y que no es un pedido nuevo', () => {
    const orden = textoDeContinuacion({ pendingCount: 2, emptyCount: 1 });

    expect(orden).toContain('2 item(s) still missing, 1 created but still empty');
    expect(orden).toContain('not a new request');
  });
});

function uso(entrada: number, salida: number) {
  return {
    inputTokens: { total: entrada, noCache: entrada, cacheRead: undefined, cacheWrite: undefined },
    outputTokens: { total: salida, text: salida, reasoning: undefined }
  };
}

function modeloQueDice(frase: string) {
  return new MockLanguageModelV4({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: 'stream-start' as const, warnings: [] },
          { type: 'text-start' as const, id: 't' },
          { type: 'text-delta' as const, id: 't', delta: frase },
          { type: 'text-end' as const, id: 't' },
          { type: 'finish' as const, finishReason: { unified: 'stop' as const, raw: 'stop' }, usage: uso(10, 5) }
        ]
      })
    })
  });
}

describe('dos tramos, una sola respuesta', () => {
  it('el segundo tramo continúa el MISMO mensaje: un start, un finish, las dos partes, y se guarda así', async () => {
    const guardados: UIMessage[][] = [];
    const tramosPedidos: number[] = [];
    const pedido: UIMessage[] = [texto('u1', 'user', 'Construí el curso.')];
    let finishesVistos = 0;

    const respuesta = responderRonda({
      resultado: streamText({ model: modeloQueDice('Tramo uno: escribí 4 lecciones.'), prompt: 'a', maxRetries: 0 }),
      mensajesOriginales: pedido,
      onError: () => 'error',
      messageMetadata: ({ part }) => (part.type === 'finish' ? { finishDelTramo: ++finishesVistos } : undefined),
      guardar: async (mensajes) => {
        guardados.push(mensajes);
      },
      siguienteTramo: async ({ numero }) => {
        tramosPedidos.push(numero);

        return numero === 1
          ? streamText({ model: modeloQueDice('Tramo dos: escribí las 2 que faltaban.'), prompt: 'b', maxRetries: 0 })
          : null;
      }
    });

    const { partes } = await leerPartes(respuesta);
    const tipos = partes.map((parte) => parte.type);

    expect(tramosPedidos).toEqual([1, 2]);
    expect(tipos.filter((tipo) => tipo === 'start')).toHaveLength(1);
    expect(tipos.filter((tipo) => tipo === 'finish')).toHaveLength(1);
    // El finish que sale es el del ÚLTIMO tramo, con su metadata.
    expect(tipos.at(-1)).toBe('finish');
    expect(partes.at(-1)).toMatchObject({ messageMetadata: { finishDelTramo: 2 } });

    const ultimoGuardado = guardados.at(-1)!;

    expect(ultimoGuardado.map((m) => m.role)).toEqual(['user', 'assistant']);

    const textoGuardado = ultimoGuardado[1].parts
      .filter((parte): parte is { type: 'text'; text: string } => parte.type === 'text')
      .map((parte) => parte.text)
      .join(' | ');

    expect(textoGuardado).toContain('Tramo uno');
    expect(textoGuardado).toContain('Tramo dos');
    // Se guardó al terminar cada tramo: si el segundo muere, el primero ya está.
    expect(guardados.length).toBeGreaterThanOrEqual(2);
  });

  it('sin otro tramo sale el finish de siempre', async () => {
    const respuesta = responderRonda({
      resultado: streamText({ model: modeloQueDice('Listo.'), prompt: 'a', maxRetries: 0 }),
      mensajesOriginales: [texto('u1', 'user', 'Hola')],
      onError: () => 'error',
      messageMetadata: () => undefined,
      siguienteTramo: async () => null
    });

    const { partes } = await leerPartes(respuesta);

    expect(partes.map((parte) => parte.type).filter((tipo) => tipo === 'finish')).toHaveLength(1);
  });
});
