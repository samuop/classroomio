import { actividadDelAgente, duracionLegible, tituloDelPensamiento } from './activity';

/**
 * La línea de «qué está haciendo ahora».
 *
 * Lo que importa es que nombre lo concreto —qué fuente lee, qué lección
 * escribe— y que no cuente como pasos las tarjetas del plan.
 */

const herramienta = (nombre: string, state: string, input?: object, output?: object) => ({
  type: `tool-${nombre}`,
  state,
  input,
  output
});

const nombres = new Map([
  ['src-manual', 'Manual de seguridad.pdf'],
  ['lec-1', 'Uso del extintor']
]);
const nombrar = (id: string) => nombres.get(id);

describe('qué está haciendo el agente ahora', () => {
  it('una herramienta corriendo dice qué toca, por nombre', () => {
    const { ahora } = actividadDelAgente(
      [herramienta('read_source', 'input-available', { sourceId: 'src-manual', offset: 105 })],
      nombrar
    );

    expect(ahora).toEqual({
      tipo: 'herramienta',
      linea: {
        shape: 'i18n',
        key: 'ai_assistant.tool.pending.read_source_named',
        vars: { name: 'Manual de seguridad.pdf', from: 105 }
      }
    });
  });

  it('escribir una lección existente la nombra por su título', () => {
    const { ahora } = actividadDelAgente([herramienta('write_lesson', 'input-available', { lessonId: 'lec-1' })], nombrar);

    expect(ahora).toMatchObject({ linea: { key: 'ai_assistant.tool.pending.write_lesson_named', vars: { title: 'Uso del extintor' } } });
  });

  it('la búsqueda muestra lo que busca', () => {
    const { ahora } = actividadDelAgente([herramienta('search_document', 'input-streaming', { query: 'extintor clase b' })]);

    expect(ahora).toMatchObject({ linea: { vars: { query: 'extintor clase b' } } });
  });

  it('sin el nombre, cae a la línea genérica en vez de mostrar un id', () => {
    const { ahora } = actividadDelAgente([herramienta('read_source', 'input-available', { sourceId: 'desconocido' })], nombrar);

    expect(ahora).toMatchObject({ linea: { key: 'ai_assistant.tool.pending.read_source' } });
  });

  it('después de una herramienta terminada, está pensando el paso siguiente', () => {
    const actividad = actividadDelAgente([
      herramienta('search_document', 'output-available', { query: 'x' }, { passages: [] }),
      herramienta('read_source', 'output-available', { sourceId: 'src-manual' }, { content: '' })
    ]);

    expect(actividad).toEqual({ ahora: { tipo: 'pensando', titulo: null }, pasos: 2, hechos: 2, fallidos: 0 });
  });

  it('un razonamiento al final muestra su título', () => {
    const { ahora } = actividadDelAgente([
      herramienta('search_document', 'output-available', {}, {}),
      { type: 'reasoning', text: '**Reading the sources**\n\nFirst...\n\n**Locating the protocol**\n\nIt is in June.' }
    ]);

    expect(ahora).toEqual({ tipo: 'pensando', titulo: 'Locating the protocol' });
  });

  it('texto al final es la respuesta que se está redactando', () => {
    const { ahora } = actividadDelAgente([{ type: 'step-start' }, { type: 'text', text: 'Listo, reescribí' }]);

    expect(ahora).toEqual({ tipo: 'escribiendo' });
  });

  it('la tarjeta del plan no cuenta como paso, y un fallo sí', () => {
    const actividad = actividadDelAgente([
      herramienta('generate_course_plan', 'output-available', {}, {}),
      herramienta('create_section', 'output-error', {}),
      herramienta('create_lesson', 'output-available', {}, { ok: false, error: 'x' })
    ]);

    expect(actividad).toMatchObject({ pasos: 2, hechos: 0, fallidos: 2 });
  });
});

describe('el título de un razonamiento', () => {
  it('toma el último título en negrita', () => {
    expect(tituloDelPensamiento('**Uno**\n\ntexto\n\n**Dos**\n\nmás')).toBe('Dos');
  });

  it('sin título no inventa uno', () => {
    expect(tituloDelPensamiento('Estoy mirando **una palabra** en el medio')).toBeNull();
  });
});

describe('la duración legible', () => {
  it('parte en minutos y segundos', () => {
    expect(duracionLegible(59_400)).toEqual({ minutos: 0, segundos: 59 });
    expect(duracionLegible(185_000)).toEqual({ minutos: 3, segundos: 5 });
  });
});
