import type { ModelMessage } from 'ai';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@cio/db/queries/agent', () => ({}));

const { sanitizeChatMessages } = await import('@api/services/agent/chat-history');
const { MAX_SALIDA_DE_HERRAMIENTA_CHARS, MENSAJES_RECIENTES, trimMessageHistory } = await import('@api/services/agent/context-window');
const { lecturasDeFuenteAConservar, podarHerramientas } = await import('@api/services/agent/poda-de-lecturas');

/**
 * Lo que el asistente conserva de una ronda a la siguiente.
 *
 * Medido en producción el 2026-11-12: una lección leída quedaba guardada con
 * 2.000 de sus 10.000 caracteres, cada guardado volvía a recortar lo recortado
 * (un `preview` adentro de otro), a los veinte mensajes el principio de la
 * conversación se cambiaba por un resumen, y lo leído del documento se perdía
 * al empezar cada ronda, así que se releía en todas.
 *
 * Textos inventados.
 */

const LECCION = `<h3>Arqueo de caja</h3>${'<p>La caja se cuenta al cierre de cada turno, con el encargado presente.</p>'.repeat(140)}`;

const respuestaCon = (herramienta: string, output: unknown) => ({
  id: 'a1',
  role: 'assistant',
  parts: [{ type: `tool-${herramienta}`, toolCallId: 't1', state: 'output-available', input: {}, output }, { type: 'text', text: 'Listo.' }]
});

const salidaDe = (mensajes: unknown[]) => (mensajes[0] as { parts: Array<{ output: unknown }> }).parts[0].output;

/** Un ejercicio con sus preguntas: lo que se recortaba era lo anidado, no el texto suelto. */
const ejercicio = (preguntas: number) => ({
  id: 'e1',
  title: 'Evaluación de caja',
  questions: Array.from({ length: preguntas }, (_, i) => ({
    id: i,
    title: `¿Qué se hace en el paso ${i} del arqueo de caja cuando el encargado no está presente?`,
    options: ['Se espera al encargado.', 'Se cuenta igual y se deja asentado.', 'Se pasa al turno siguiente.']
  }))
});

describe('lo que se guarda de un resultado de herramienta', () => {
  it('un ejercicio leído con todas sus preguntas se guarda entero', () => {
    const leido = ejercicio(30);

    expect(JSON.stringify(leido).length).toBeGreaterThan(5_000);
    expect(JSON.stringify(leido).length).toBeLessThan(MAX_SALIDA_DE_HERRAMIENTA_CHARS);
    expect(salidaDe(sanitizeChatMessages([respuestaCon('get_exercise_details', leido)]))).toEqual(leido);
  });

  it('lo que pasa del tope se recorta y lo dice', () => {
    const salida = salidaDe(sanitizeChatMessages([respuestaCon('get_exercise_details', ejercicio(400))])) as Record<string, unknown>;

    expect(salida.truncated).toBe(true);
    expect(salida.id).toBe('e1');
    expect(salida.questions).toBeUndefined();
    expect(String(salida.preview)).toMatch(/\.\.\.\[truncated\]$/);
  });

  it('guardar dos veces no recorta lo ya recortado: nada de un recorte adentro de otro', () => {
    const una = sanitizeChatMessages([respuestaCon('get_exercise_details', ejercicio(400))]);
    const tres = sanitizeChatMessages(sanitizeChatMessages(una));

    expect(tres).toEqual(una);
    expect(String((salidaDe(tres) as { preview: string }).preview)).not.toContain('"preview"');
  });
});

describe('lo que vuelve al modelo de la conversación', () => {
  const ida = (i: number) => ({ id: `m${i}`, role: i % 2 ? 'assistant' : 'user', parts: [{ type: 'text', text: `mensaje ${i}` }] });

  it('una conversación de treinta mensajes vuelve entera', () => {
    const conversacion = Array.from({ length: 30 }, (_, i) => ida(i));

    expect(trimMessageHistory(conversacion)).toHaveLength(30);
  });

  it('recién pasada de los que entran se queda con el primero y los últimos', () => {
    const conversacion = Array.from({ length: 80 }, (_, i) => ida(i));
    const recortada = trimMessageHistory(conversacion);

    expect(recortada).toHaveLength(MENSAJES_RECIENTES + 1);
    expect(recortada[0].id).toBe('m0');
    expect(recortada.at(-1).id).toBe('m79');
  });

  it('la lección leída en la ronda anterior llega entera, no por la quinta parte', () => {
    const [mensaje] = trimMessageHistory([respuestaCon('get_lesson_content', { content: LECCION })]);

    expect(mensaje.parts[0].output).toEqual({ content: LECCION });
  });
});

describe('lo leído de los documentos, de una ronda a la otra', () => {
  const llamada = (id: string, toolName: string, input: unknown) => ({ type: 'tool-call', toolCallId: id, toolName, input });
  const resultado = (id: string, toolName: string, value: unknown) => ({ type: 'tool-result', toolCallId: id, toolName, output: { type: 'json', value } });
  const HISTORIA = [
    { role: 'user', content: '¿Esto es correcto?' },
    {
      role: 'assistant',
      content: [
        llamada('f1', 'read_source', { sourceId: 's', offset: 1, limit: 100 }),
        llamada('b1', 'search_document', { query: 'arqueo' }),
        llamada('l1', 'get_lesson_content', { lessonId: 'S1.L1' }),
        llamada('f2', 'read_source', { sourceId: 's', offset: 1, limit: 100 }),
        llamada('f3', 'read_source', { sourceId: 's', offset: 101, limit: 100 })
      ]
    },
    {
      role: 'tool',
      content: [
        resultado('f1', 'read_source', { content: 'primera lectura' }),
        resultado('b1', 'search_document', { passages: ['La caja se cuenta al cierre.'] }),
        resultado('l1', 'get_lesson_content', { content: 'la lección como estaba' }),
        resultado('f2', 'read_source', { content: 'la misma, releída' }),
        resultado('f3', 'read_source', { truncated: true, preview: 'un pasaje que quedó guardado por la mi...[truncated]' })
      ]
    },
    { role: 'assistant', content: [{ type: 'text', text: 'Sí.' }] },
    { role: 'user', content: '¿Y lo podés justificar con la fuente?' },
    { role: 'assistant', content: [{ type: 'text', text: 'Sí, dice esto.' }] },
    { role: 'user', content: 'Corregilo.' }
  ] as unknown as ModelMessage[];

  it('se conserva la última lectura de cada pedido a la fuente, y nada del curso', () => {
    expect([...lecturasDeFuenteAConservar(HISTORIA)].sort()).toEqual(['b1', 'f2']);
  });

  it('al empezar la ronda siguiente, la fuente leída sigue ahí y la lección vieja no', () => {
    const podada = podarHerramientas({ messages: HISTORIA, ultimos: 2, conservar: lecturasDeFuenteAConservar(HISTORIA) });
    const texto = JSON.stringify(podada);

    expect(texto).toContain('la misma, releída');
    expect(texto).toContain('La caja se cuenta al cierre.');
    // La lección pudo cambiar desde entonces: se vuelve a leer.
    expect(texto).not.toContain('la lección como estaba');
    // La lectura repetida y la que quedó recortada no vuelven.
    expect(texto).not.toContain('primera lectura');
    expect(texto).not.toContain('quedó guardado por la mi');
    // Y lo que dijeron las dos partes queda intacto.
    expect(texto).toContain('¿Y lo podés justificar con la fuente?');
  });
});
