import { streamText } from 'ai';
import { MockLanguageModelV4, simulateReadableStream } from 'ai/test';

import { HERRAMIENTAS_DE_LECTURA, pasoPudoCambiarElCurso } from '@api/services/agent/pasos-que-cambian';

/**
 * El progreso del plan tiene que llegar al panel.
 *
 * ── Lo que se midió (producción, 2026-09-12) ─────────────────────────────────
 *
 * `planProgress` apareció CERO veces en los 24 streams guardados de todas las
 * corridas del agente. Tampoco `continuation.finishReason`. Los dos se
 * asignaban dentro del `onFinish` de `streamText`, y la metadata del mensaje
 * se arma con una función síncrona que corre sobre la parte `finish`.
 *
 * Consecuencias: la continuación automática de la construcción nunca se
 * disparó, el checklist del servidor nunca se dibujó, y la señal de «plan
 * incompleto» —la que cubre al modelo que se detiene diciendo que terminó—
 * era inalcanzable.
 *
 * ── Qué fija este archivo ────────────────────────────────────────────────────
 *
 * 1. El ORDEN del SDK del que depende el arreglo: lo que se escribe en un
 *    `onStepFinish` asíncrono llega a la metadata; lo que se escribe en
 *    `onFinish`, no. Si una versión nueva del SDK cambia ese orden, esto se
 *    rompe acá y no en silencio en producción.
 * 2. Cuándo vale la pena recalcular: después de cualquier paso que no sea
 *    una lectura pura, contando lo desconocido como escritura.
 */

const USO = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined }
};

function modeloQueContesta() {
  return new MockLanguageModelV4({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: 'stream-start' as const, warnings: [] },
          { type: 'text-start' as const, id: 't1' },
          { type: 'text-delta' as const, id: 't1', delta: 'listo' },
          { type: 'text-end' as const, id: 't1' },
          { type: 'finish' as const, finishReason: { unified: 'stop' as const, raw: 'stop' }, usage: USO }
        ]
      })
    })
  });
}

/** La metadata que el panel recibe con la parte `finish`, tal como sale del stream de UI. */
async function metadataDelFinal(opciones: {
  onStepFinish: () => Promise<void>;
  onFinish: () => Promise<void>;
  leer: () => Record<string, unknown>;
}): Promise<Record<string, unknown> | undefined> {
  const resultado = streamText({
    model: modeloQueContesta(),
    prompt: 'hola',
    onStepFinish: opciones.onStepFinish,
    onFinish: opciones.onFinish
  });

  const stream = resultado.toUIMessageStream({
    messageMetadata: ({ part }) => (part.type === 'finish' ? opciones.leer() : undefined)
  });

  let metadata: Record<string, unknown> | undefined;

  for await (const parte of stream) {
    const conMetadata = parte as { type: string; messageMetadata?: Record<string, unknown> };
    if (conMetadata.type === 'finish' && conMetadata.messageMetadata) {
      metadata = conMetadata.messageMetadata;
    }
  }

  return metadata;
}

describe('el orden del SDK del que depende el progreso del plan', () => {
  it('lo que calcula un onStepFinish asíncrono llega a la metadata del mensaje', async () => {
    let progreso: string | undefined;

    const metadata = await metadataDelFinal({
      onStepFinish: async () => {
        // Una espera real, como las tres consultas a la base: si el SDK no
        // esperara al callback, el valor todavía no existiría.
        await new Promise((resolver) => setTimeout(resolver, 25));
        progreso = 'medido';
      },
      onFinish: async () => {},
      leer: () => ({ progreso })
    });

    expect(metadata).toEqual({ progreso: 'medido' });
  });

  it('lo que se calcula en onFinish NO llega: por eso el arreglo no puede vivir ahí', async () => {
    let progreso: string | undefined;

    const metadata = await metadataDelFinal({
      onStepFinish: async () => {},
      onFinish: async () => {
        progreso = 'medido';
      },
      leer: () => ({ progreso })
    });

    // Si esto empieza a fallar, el SDK cambió el orden: `onFinish` volvería a
    // servir, y el comentario de `recalcularProgresoDelPlan` quedaría viejo.
    expect(metadata).toEqual({ progreso: undefined });
  });
});

describe('cuándo recalcular el progreso', () => {
  it('no recalcula después de un paso que sólo leyó', () => {
    expect(pasoPudoCambiarElCurso(['get_course_structure', 'read_lessons', 'search_lessons'])).toBe(false);
  });

  it('no recalcula después de un paso sin herramientas', () => {
    expect(pasoPudoCambiarElCurso([])).toBe(false);
  });

  it('recalcula después de escribir una lección', () => {
    expect(pasoPudoCambiarElCurso(['write_lesson'])).toBe(true);
  });

  it('recalcula aunque el paso haya mezclado lecturas y una escritura', () => {
    expect(pasoPudoCambiarElCurso(['read_source', 'get_lesson_content', 'edit_lesson_content'])).toBe(true);
  });

  it('recalcula después de armar el examen, que no deja rastro en el registro de la ronda', () => {
    // El caso medido: la ronda que creó los cinco bloques que le faltaban al
    // examen final no escribió ninguna lección.
    expect(pasoPudoCambiarElCurso(['create_exercise_section', 'add_questions'])).toBe(true);
  });

  it('una herramienta que nadie anotó cuenta como escritura', () => {
    // Una herramienta de escritura agregada mañana tiene que disparar el
    // recálculo sin que nadie se acuerde de este archivo.
    expect(pasoPudoCambiarElCurso(['herramienta_que_todavia_no_existe'])).toBe(true);
  });

  it('ninguna herramienta que cambia el curso figura como lectura', () => {
    const escrituras = [
      'write_lesson',
      'create_lesson',
      'create_section',
      'create_exercise',
      'create_exercise_section',
      'add_questions',
      'update_questions',
      'edit_lesson_content',
      'replace_lesson_block',
      'update_lesson_content',
      'delete_lesson',
      'delete_section',
      'delete_exercise',
      'reorder_content'
    ];

    expect(escrituras.filter((nombre) => HERRAMIENTAS_DE_LECTURA.has(nombre))).toEqual([]);
  });
});
