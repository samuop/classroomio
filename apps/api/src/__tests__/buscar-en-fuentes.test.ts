import { buscarEnFuentes, terminosDeBusqueda, tramosDeBusqueda } from '@api/services/agent/source-search';

/**
 * Buscar un tema dentro del texto de las fuentes del curso.
 *
 * El caso medido: siete presentaciones mensuales con nombres que no dicen de qué
 * tratan, que repiten diapositivas enteras de un mes a otro, y un protocolo que
 * sólo está en dos. Sin búsqueda, el agente releyó cinco talleres 31 veces y
 * nunca abrió los dos que lo tenían.
 *
 * Los datos de abajo tienen esa forma, con contenido inventado de otro rubro: una
 * diapositiva que se repite idéntica en dos talleres en posiciones distintas, y
 * otras que no tienen nada que ver.
 */

const BLOQUE_DE_DEVOLUCIONES = [
  'Proceso de devolución de libros',
  'El bibliotecario del turno de la tarde carga en el catálogo los libros devueltos y arma la pila para reubicar.',
  'En salas con mostrador se recibe sólo lo que el lector entrega en mano.',
  'Al terminar la jornada se revisan 10 fichas del catálogo.'
];

const TALLER_MARZO = {
  id: 'src-marzo',
  fileName: 'Taller marzo.pptx',
  text: [
    'BIBLIOTECA', 'MARZO', '', '---', '',
    'Control de lámparas', 'Limpiar los estantes de la sala cada semana.', 'Las quemadas se anotan en el cuaderno.', '', '---', '',
    'Normas de sala', 'Las ventanas se abren por la mañana.'
  ].join('\n')
};

const TALLER_JUNIO = {
  id: 'src-junio',
  fileName: 'Taller junio.pptx',
  text: [
    'BIBLIOTECA', 'JUNIO', '', '---', '',
    'Control de lámparas', 'Limpiar los estantes de la sala cada semana.', '', '---', '',
    ...BLOQUE_DE_DEVOLUCIONES, '', '---', '',
    'Normas de sala', 'Las ventanas se abren por la mañana.'
  ].join('\n')
};

const TALLER_AGOSTO = {
  id: 'src-agosto',
  fileName: 'Taller agosto.pptx',
  text: [
    'BIBLIOTECA', 'AGOSTO', '', '---', '',
    ...BLOQUE_DE_DEVOLUCIONES, '', '---', '',
    'Aviso por inundación', 'Subir las computadoras de consulta a la mesa.'
  ].join('\n')
};

const TALLERES = [TALLER_MARZO, TALLER_JUNIO, TALLER_AGOSTO];

describe('buscar un tema en las fuentes del curso', () => {
  it('encuentra el protocolo y dice en qué fuentes está — y sólo en esas', () => {
    const { sourcesWithMatches } = buscarEnFuentes({
      fuentes: TALLERES,
      consulta: 'devolucion libros turno mostrador'
    });

    expect(sourcesWithMatches.map((f) => f.fileName)).toEqual(['Taller junio.pptx', 'Taller agosto.pptx']);
  });

  it('una diapositiva repetida en dos fuentes vuelve UNA vez, con las dos ubicaciones', () => {
    const { passages } = buscarEnFuentes({ fuentes: TALLERES, consulta: 'devolucion libros turno mostrador' });

    expect(passages).toHaveLength(1);
    expect(passages[0].locations).toEqual([
      { sourceId: 'src-junio', fileName: 'Taller junio.pptx', fromLine: 11, toLine: 14 },
      { sourceId: 'src-agosto', fileName: 'Taller agosto.pptx', fromLine: 6, toLine: 9 }
    ]);
  });

  it('la línea que devuelve es la misma que numera read_source', () => {
    const { passages } = buscarEnFuentes({ fuentes: TALLERES, consulta: 'devolucion libros' });

    for (const { sourceId, fromLine } of passages[0].locations) {
      const fuente = TALLERES.find((t) => t.id === sourceId)!;
      // `recortarLineas` parte por salto de línea y numera desde 1.
      expect(fuente.text.split('\n')[fromLine - 1]).toBe('Proceso de devolución de libros');
    }
  });

  it('las fuentes que tratan el tema entero van antes que las que lo rozan', () => {
    // Marzo toca «estantes» y «semana»; junio y agosto tienen el protocolo con
    // «libros», «catálogo» y «turno». En orden de subida marzo iría primero.
    const { sourcesWithMatches } = buscarEnFuentes({
      fuentes: TALLERES,
      consulta: 'estantes semana libros catalogo turno'
    });

    expect(sourcesWithMatches.map((f) => [f.sourceId, f.bestMatchedTerms])).toEqual([
      ['src-junio', 3],
      ['src-agosto', 3],
      ['src-marzo', 2]
    ]);
  });

  it('no le importan las tildes, las mayúsculas ni el plural', () => {
    const { sourcesWithMatches } = buscarEnFuentes({ fuentes: TALLERES, consulta: 'DEVOLUCIÓN del Libro' });

    expect(sourcesWithMatches.map((f) => f.sourceId)).toEqual(['src-junio', 'src-agosto']);
  });

  it('encuentra el singular aunque la fuente diga el plural', () => {
    const { sourcesWithMatches } = buscarEnFuentes({ fuentes: TALLERES, consulta: 'estante lampara' });

    expect(sourcesWithMatches.map((f) => f.sourceId)).toEqual(['src-marzo', 'src-junio']);
  });

  it('un número tiene que ser ese número', () => {
    expect(buscarEnFuentes({ fuentes: TALLERES, consulta: '10 fichas' }).sourcesWithMatches).toHaveLength(2);
    expect(buscarEnFuentes({ fuentes: TALLERES, consulta: '1 fichas' }).passages).toEqual([]);
  });

  it('con varios términos, un tramo que nombra uno solo no cuenta', () => {
    // «catálogo» aparece sólo dentro del bloque de devoluciones; «inundación», sólo
    // en agosto y en otra diapositiva. Ningún tramo tiene los dos.
    expect(buscarEnFuentes({ fuentes: TALLERES, consulta: 'inundacion catalogo' }).passages).toEqual([]);
  });

  it('con un solo término, alcanza con ese', () => {
    const { sourcesWithMatches } = buscarEnFuentes({ fuentes: TALLERES, consulta: 'inundacion' });

    expect(sourcesWithMatches.map((f) => f.sourceId)).toEqual(['src-agosto']);
  });

  it('un tema que no está en ninguna fuente devuelve vacío, sin inventar coincidencias', () => {
    expect(buscarEnFuentes({ fuentes: TALLERES, consulta: 'uniforme vacaciones' })).toEqual({
      terms: ['uniforme', 'vacaciones'],
      passages: [],
      sourcesWithMatches: []
    });
  });

  it('una consulta hecha sólo de palabras vacías no busca nada', () => {
    expect(terminosDeBusqueda('de la y el para con')).toEqual([]);
    expect(buscarEnFuentes({ fuentes: TALLERES, consulta: 'de la y el' }).passages).toEqual([]);
  });
});

describe('los tramos donde se busca', () => {
  it('cada diapositiva es un tramo: el separador y la línea vacía cortan', () => {
    expect(tramosDeBusqueda(TALLER_AGOSTO.text.split('\n'))).toEqual([
      { desde: 1, hasta: 2 },
      { desde: 6, hasta: 9 },
      { desde: 13, hasta: 14 }
    ]);
  });

  it('un párrafo largo se parte en ventanas que se pisan y lo cubren entero', () => {
    const lineas = Array.from({ length: 40 }, (_, i) => `Línea número ${i + 1} de un párrafo largo sin cortes.`);
    const tramos = tramosDeBusqueda(lineas);

    expect(tramos.length).toBeGreaterThan(1);
    expect(tramos[0].desde).toBe(1);
    expect(tramos[tramos.length - 1].hasta).toBe(40);
    for (let i = 1; i < tramos.length; i++) {
      // Cada ventana arranca antes de que termine la anterior: nada queda en un hueco.
      expect(tramos[i].desde).toBeLessThanOrEqual(tramos[i - 1].hasta);
    }
  });
});
