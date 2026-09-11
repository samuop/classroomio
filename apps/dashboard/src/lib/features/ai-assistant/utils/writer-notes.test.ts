/**
 * Las notas del escritor de lecciones.
 *
 * El escritor no puede hablar con el docente: lo que no pudo cubrir vuelve como
 * `writerNote` en el resultado de `write_lesson`, y el prompt le pide al agente
 * que lo repita. Medido en dev, no lo hizo — la nota de que una lección se
 * escribió sin el material interno de la empresa nunca llegó al docente. Por
 * eso se lee directo del resultado de la herramienta; lo que se fija acá es que
 * se lea bien.
 */
import { getWriterNotes } from './writer-notes';

function escribio(output: Record<string, unknown>, state = 'output-available') {
  return { type: 'tool-write_lesson', toolCallId: 'call-1', state, input: {}, output };
}

describe('las notas del escritor', () => {
  it('saca la nota, con la lección a la que pertenece — el caso medido', () => {
    const notas = getWriterNotes([
      escribio({
        lessonId: 'l-1',
        lessonTitle: 'Elementos de protección personal',
        writerNote: 'Se escribió desde buenas prácticas generales: no se suministró el reglamento interno.'
      })
    ]);

    expect(notas).toEqual([
      {
        lessonId: 'l-1',
        title: 'Elementos de protección personal',
        note: 'Se escribió desde buenas prácticas generales: no se suministró el reglamento interno.'
      }
    ]);
  });

  it('no inventa una nota donde el escritor no dejó ninguna', () => {
    expect(getWriterNotes([escribio({ lessonId: 'l-1', lessonTitle: 'X' })])).toEqual([]);
    expect(getWriterNotes([escribio({ lessonId: 'l-1', lessonTitle: 'X', writerNote: '   ' })])).toEqual([]);
  });

  it('sólo mira write_lesson: las demás herramientas no tienen escritor', () => {
    const otra = { type: 'tool-create_lesson', toolCallId: 'c', state: 'output-available', output: { writerNote: 'no' } };

    expect(getWriterNotes([otra])).toEqual([]);
  });

  it('ignora el texto y las partes que no son de herramientas', () => {
    expect(getWriterNotes([{ type: 'text', text: 'hola' }, { type: 'reasoning', text: '…' }])).toEqual([]);
  });

  it('junta las notas de varias lecciones, en orden', () => {
    const notas = getWriterNotes([
      escribio({ lessonId: 'a', lessonTitle: 'A', writerNote: 'nota a' }),
      escribio({ lessonId: 'b', lessonTitle: 'B' }),
      escribio({ lessonId: 'c', lessonTitle: 'C', writerNote: 'nota c' })
    ]);

    expect(notas.map((n) => n.lessonId)).toEqual(['a', 'c']);
  });

  it('una llamada que todavía no terminó no tiene nota que mostrar', () => {
    expect(getWriterNotes([escribio({ writerNote: 'x' }, 'input-available')])).toEqual([]);
  });
});
