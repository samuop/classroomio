import { anotarCambio, lineasDelRegistro, registroVacio } from '@api/services/agent/round-ledger';

/**
 * Lo que la ronda cambió de verdad, medido por el servidor.
 *
 * ── Qué problema resuelve ────────────────────────────────────────────────────
 *
 * El relato del modelo sobre su propio trabajo no es evidencia. Medido en un
 * solo día de producción, cuatro veces: dijo haber escrito una lección con un
 * id que no existe, haber eliminado seis menciones cuando eliminó cuatro, se
 * atribuyó diagramas que ya estaban, y cerró con «era la única lección donde
 * figuraba» justo después de editar cinco.
 *
 * No se puede impedir que lo diga. Lo que sí se puede es poner al lado lo que
 * el servidor vio pasar — el mismo principio que el informe de construcción de
 * cada lección, y que el progreso del plan, que ya reemplazó por este motivo la
 * lista que llevaba el modelo.
 */
describe('el registro de la ronda', () => {
  it('arranca vacío, así una ronda que no cambió nada no muestra nada', () => {
    expect(lineasDelRegistro(registroVacio())).toEqual([]);
  });

  it('anota lo que se escribió, con el título que el docente reconoce', () => {
    const registro = registroVacio();

    anotarCambio(registro, 'escribio', 'Interpretar el organigrama general');

    expect(lineasDelRegistro(registro)).toEqual(['Escribió «Interpretar el organigrama general»']);
  });

  it('junta las repeticiones sobre lo mismo y las cuenta', () => {
    // Tres ediciones a la misma lección son UN hecho —«la tocó tres veces»— y
    // no tres. Una lista de treinta líneas repetidas es tan ilegible como no
    // tener nada.
    const registro = registroVacio();

    anotarCambio(registro, 'edito', 'Roles comerciales');
    anotarCambio(registro, 'edito', 'Roles comerciales');
    anotarCambio(registro, 'edito', 'Roles comerciales');

    expect(lineasDelRegistro(registro)).toEqual(['Editó «Roles comerciales» (3 veces)']);
  });

  it('no junta acciones distintas sobre el mismo objeto', () => {
    // Escribirla y después ilustrarla son dos cosas, y al docente le importan
    // las dos.
    const registro = registroVacio();

    anotarCambio(registro, 'escribio', 'Historia');
    anotarCambio(registro, 'ilustro', 'Historia');

    expect(lineasDelRegistro(registro)).toHaveLength(2);
  });

  it('conserva el orden en que pasaron las cosas', () => {
    const registro = registroVacio();

    anotarCambio(registro, 'creo', 'Sección 3');
    anotarCambio(registro, 'escribio', 'Primera lección');
    anotarCambio(registro, 'borro', 'Lección vieja');

    expect(lineasDelRegistro(registro)).toEqual([
      'Creó «Sección 3»',
      'Escribió «Primera lección»',
      'Borró «Lección vieja»'
    ]);
  });

  /**
   * El caso exacto que motivó todo: la ronda editó CINCO lecciones y el modelo
   * cerró diciendo que era una sola. El registro deja las cinco a la vista, y
   * el docente ve la diferencia sin abrir nada.
   */
  it('deja ver las cinco cuando el relato dice una', () => {
    const registro = registroVacio();

    for (const titulo of ['Protocolos', 'Historia', 'Organigrama', 'Roles', 'Presencia regional']) {
      anotarCambio(registro, 'edito', titulo);
    }

    expect(lineasDelRegistro(registro)).toHaveLength(5);
  });

  it('no se cae con un título vacío', () => {
    // Una lección sin título existe: la crea el plan y todavía no se llenó.
    const registro = registroVacio();

    anotarCambio(registro, 'edito', '   ');

    expect(lineasDelRegistro(registro)).toEqual(['Editó «(sin título)»']);
  });
});
