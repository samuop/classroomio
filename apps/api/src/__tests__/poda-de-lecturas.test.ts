import { describe, expect, it } from 'vitest';
import type { ModelMessage } from 'ai';
import { lecturasAConservar, podarHerramientas } from '@api/services/agent/poda-de-lecturas';

/**
 * La poda de contexto no se puede comer la lectura que todavía no se usó.
 *
 * ── Qué se midió ─────────────────────────────────────────────────────────────
 *
 * 2026-09-22, ronda 1 de «subí una circular y actualizá la sección»: 23
 * `get_lesson_content` + 16 `get_exercise_details` y TRES ediciones, contra el
 * tope de 40 pasos. La orden de trabajo tenía cinco targets: el modelo leía los
 * cinco y, al llegar al quinto, ya no tenía el primero. Cinco lecturas
 * repetidas siete veces = 35 pasos.
 *
 * Acá se fija que la última lectura de cada pieza sobrevive a la poda, que las
 * viejas de la misma pieza no, y que ningún OTRO resultado se salva por esto.
 *
 * Curso inventado, de una mesa de ayuda que no existe.
 */

let contador = 0;

/** Un par assistant+tool, como lo arma el SDK: la llamada y su resultado. */
function lectura(toolName: string, pieza: string, campo: string): ModelMessage[] {
  const toolCallId = `llamada-${(contador += 1)}`;

  return [
    {
      role: 'assistant',
      content: [{ type: 'tool-call', toolCallId, toolName, input: { [campo]: pieza } }]
    } as ModelMessage,
    {
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId,
          toolName,
          output: { type: 'json', value: { lessonId: pieza, content: `<p>${pieza}</p>` } }
        }
      ]
    } as ModelMessage
  ];
}

function leerLeccion(manija: string): ModelMessage[] {
  return lectura('get_lesson_content', manija, 'lessonId');
}

function leerEjercicio(manija: string): ModelMessage[] {
  return lectura('get_exercise_details', manija, 'exerciseId');
}

/** Un paso que no es una lectura: lo que la dieta SÍ tiene que podar. */
function edicion(manija: string): ModelMessage[] {
  return lectura('replace_lesson_block', manija, 'lessonId');
}

function podar(messages: ModelMessage[]): ModelMessage[] {
  return podarHerramientas({ messages, ultimos: 4, conservar: lecturasAConservar(messages) });
}

/** Qué piezas siguen teniendo su resultado en el hilo podado. */
function piezasQueSobreviven(messages: ModelMessage[], toolName: string): string[] {
  const vivas: string[] = [];

  for (const message of messages) {
    if (typeof message.content === 'string') continue;

    for (const parte of message.content as Array<Record<string, unknown>>) {
      if (parte.type === 'tool-call' && parte.toolName === toolName) {
        vivas.push(String((parte.input as Record<string, string>).lessonId ?? (parte.input as Record<string, string>).exerciseId));
      }
    }
  }

  return vivas;
}

describe('podar el contexto de un paso', () => {
  it('cinco lecciones leídas y seis pasos después, las cinco siguen ahí', () => {
    const messages: ModelMessage[] = [
      { role: 'user', content: 'Actualizá la sección con la circular nueva.' },
      ...leerLeccion('S1.L1'),
      ...leerLeccion('S1.L2'),
      ...leerLeccion('S1.L3'),
      ...leerLeccion('S1.L4'),
      ...leerLeccion('S1.L5'),
      ...edicion('S1.L1'),
      ...edicion('S1.L2'),
      ...edicion('S1.L3')
    ];

    expect(piezasQueSobreviven(podar(messages), 'get_lesson_content')).toEqual([
      'S1.L1',
      'S1.L2',
      'S1.L3',
      'S1.L4',
      'S1.L5'
    ]);
  });

  it('la misma lección leída dos veces conserva sólo la última', () => {
    const messages: ModelMessage[] = [
      { role: 'user', content: 'Cambiá el teléfono.' },
      ...leerLeccion('S1.L1'),
      ...leerLeccion('S1.L2'),
      ...leerLeccion('S1.L1'),
      ...edicion('S1.L2'),
      ...edicion('S1.L2')
    ];

    const podados = podar(messages);
    const vivas = piezasQueSobreviven(podados, 'get_lesson_content');

    // Una sola vez S1.L1: la segunda lectura, no la primera.
    expect(vivas).toEqual(['S1.L2', 'S1.L1']);

    const ids = podados
      .flatMap((m) => (typeof m.content === 'string' ? [] : (m.content as Array<Record<string, unknown>>)))
      .filter((p) => p.type === 'tool-call' && p.toolName === 'get_lesson_content')
      .map((p) => p.toolCallId);

    // La que sobrevive es la TERCERA llamada del hilo, no la primera.
    expect(ids).not.toContain('llamada-1');
  });

  it('un resultado que no es una lectura, anterior a los últimos 4 mensajes, se poda', () => {
    const messages: ModelMessage[] = [
      { role: 'user', content: 'Cambiá el teléfono.' },
      ...edicion('S1.L1'),
      ...leerLeccion('S1.L2'),
      ...edicion('S1.L2'),
      ...edicion('S1.L3')
    ];

    expect(piezasQueSobreviven(podar(messages), 'replace_lesson_block')).toEqual(['S1.L2', 'S1.L3']);
  });

  it('con nueve lecturas distintas se poda la más vieja', () => {
    const messages: ModelMessage[] = [
      { role: 'user', content: 'Revisá las nueve lecciones.' },
      ...Array.from({ length: 9 }, (_, i) => leerLeccion(`S1.L${i + 1}`)).flat(),
      ...edicion('S1.L9'),
      ...edicion('S1.L8')
    ];

    const vivas = piezasQueSobreviven(podar(messages), 'get_lesson_content');

    expect(vivas).toHaveLength(8);
    expect(vivas).not.toContain('S1.L1');
    expect(vivas).toContain('S1.L9');
  });

  /** Los ejercicios cuentan igual que las lecciones: son el otro camino medido. */
  it('las lecturas de ejercicio también se conservan', () => {
    const messages: ModelMessage[] = [
      { role: 'user', content: 'Corregí las preguntas.' },
      ...leerEjercicio('S1.E1'),
      ...leerEjercicio('S2.E1'),
      ...edicion('S1.L1'),
      ...edicion('S1.L2'),
      ...edicion('S1.L3')
    ];

    expect(piezasQueSobreviven(podar(messages), 'get_exercise_details')).toEqual(['S1.E1', 'S2.E1']);
  });

  /**
   * Un mensaje que se queda sin partes no puede viajar: el proveedor lo
   * rechaza. Es lo que `pruneMessages` hacía con `emptyMessages: 'remove'`.
   */
  it('los mensajes que quedan vacíos se eliminan', () => {
    const messages: ModelMessage[] = [
      { role: 'user', content: 'Cambiá el teléfono.' },
      ...edicion('S1.L1'),
      ...edicion('S1.L2'),
      ...edicion('S1.L3'),
      ...edicion('S1.L4')
    ];

    for (const message of podar(messages)) {
      expect(message.content.length).toBeGreaterThan(0);
    }
  });
});
