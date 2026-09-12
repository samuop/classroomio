import { claveDeLectura, notaDeRelectura } from '@api/services/agent/relecturas';

/**
 * Leer dos veces el mismo tramo de una fuente en la misma ronda.
 *
 * El caso medido: 31 lecturas en una ronda de 40 pasos, el mismo taller hasta
 * diez veces y siempre desde la línea 1, porque la ronda recorta de su contexto
 * lo que ya leyó. Lo que se fija acá es qué cuenta como «el mismo tramo», y que
 * la respuesta a la repetición diga qué hacer en vez de repetir el texto.
 */

const DEFECTO = 600;

describe('qué cuenta como la misma lectura', () => {
  it('sin offset y con offset 1 son la misma lectura', () => {
    expect(claveDeLectura({ sourceId: 'f1', limitePorDefecto: DEFECTO })).toBe(
      claveDeLectura({ sourceId: 'f1', offset: 1, limitePorDefecto: DEFECTO })
    );
  });

  it('sin limit y con el limit por defecto son la misma lectura', () => {
    expect(claveDeLectura({ sourceId: 'f1', offset: 1, limitePorDefecto: DEFECTO })).toBe(
      claveDeLectura({ sourceId: 'f1', offset: 1, limit: DEFECTO, limitePorDefecto: DEFECTO })
    );
  });

  it('otro tramo de la misma fuente es otra lectura: leer alrededor de un pasaje sigue funcionando', () => {
    expect(claveDeLectura({ sourceId: 'f1', offset: 1, limitePorDefecto: DEFECTO })).not.toBe(
      claveDeLectura({ sourceId: 'f1', offset: 120, limit: 40, limitePorDefecto: DEFECTO })
    );
  });

  it('el mismo tramo de otra fuente es otra lectura', () => {
    expect(claveDeLectura({ sourceId: 'f1', limitePorDefecto: DEFECTO })).not.toBe(
      claveDeLectura({ sourceId: 'f2', limitePorDefecto: DEFECTO })
    );
  });
});

describe('lo que vuelve en lugar del texto', () => {
  const nota = notaDeRelectura({ fileName: 'Taller junio.pptx', desde: 1, hasta: 182, paso: 4 });

  it('dice qué se leyó, cuándo, y por qué releerlo no sirve', () => {
    expect(nota).toContain('lines 1–182 of "Taller junio.pptx"');
    expect(nota).toContain('at step 4');
    expect(nota).toContain('trimmed from your context');
  });

  it('manda a buscar, y a pasarle las fuentes al escritor en vez de leerlas', () => {
    expect(nota).toContain('search_document');
    expect(nota).toContain('write_lesson');
  });

  it('sin paso conocido no inventa uno', () => {
    expect(notaDeRelectura({ fileName: 'x.pdf', desde: 1, hasta: 10 })).not.toContain('at step');
  });
});
