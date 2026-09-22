import { describe, expect, it, vi } from 'vitest';
import {
  crearResolutorDeManijas,
  describirCurso,
  esManija,
  esUuid,
  leerManija,
  manijaDe,
  mapaDelCurso,
  resolverBloque,
  resolverEnMapa,
  type ItemParaMapa,
  type MapaDelCurso,
  type SeccionParaMapa
} from '@api/services/agent/manijas';

/**
 * Manijas cortas: `S2`, `S2.L3`, `S2.E1`, `S2.E1.B2`.
 *
 * Lo que estos tests cuidan es lo que hace que una manija sirva: que signifique
 * SIEMPRE lo mismo mientras el curso no se mueva (de ahí el desempate estable),
 * que un tipo equivocado no resuelva a la pieza de al lado, y que cuando algo no
 * existe el error traiga la lista de lo que sí — que es lo único que le permite
 * al modelo corregirse en un paso en vez de adivinar otra vez.
 *
 * Curso inventado, de una distribuidora que no existe.
 */

const ID = {
  recepcion: '11111111-1111-4111-8111-111111111111',
  mesaDeAyuda: '22222222-2222-4222-8222-222222222222',
  leccion1: 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  leccion2: 'aaaaaaa2-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  leccion3: 'aaaaaaa3-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  ejercicio1: 'bbbbbbb1-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  suelta: 'ccccccc1-cccc-4ccc-8ccc-cccccccccccc',
  ejercicioSuelto: 'ddddddd1-dddd-4ddd-8ddd-dddddddddddd'
};

const SECCIONES: SeccionParaMapa[] = [
  { id: ID.mesaDeAyuda, title: 'Mesa de Ayuda', order: 1, createdAt: '2026-02-01T00:00:00Z' },
  { id: ID.recepcion, title: 'Recepción de pedidos', order: 0, createdAt: '2026-01-01T00:00:00Z' }
];

const ITEMS: ItemParaMapa[] = [
  // A propósito desordenados: las filas llegan como la base las devuelva.
  {
    id: ID.leccion3,
    type: 'LESSON',
    title: 'Cómo se cierra un reclamo',
    order: 3,
    sectionId: ID.mesaDeAyuda,
    hasNoteContent: true,
    isUnlocked: true
  },
  {
    id: ID.leccion1,
    type: 'LESSON',
    title: 'Qué se recibe y qué no',
    order: 0,
    sectionId: ID.recepcion,
    hasNoteContent: true
  },
  {
    id: ID.ejercicio1,
    type: 'EXERCISE',
    title: 'Autoevaluación de recepción',
    order: 1,
    sectionId: ID.recepcion,
    questionCount: 6
  },
  {
    id: ID.leccion2,
    type: 'LESSON',
    title: 'Quién atiende cada reclamo',
    order: 2,
    sectionId: ID.mesaDeAyuda,
    hasNoteContent: false
  }
];

const mapa = () => mapaDelCurso(SECCIONES, ITEMS);

describe('leer una manija', () => {
  it('reconoce las cuatro formas', () => {
    expect(leerManija('S2')).toEqual({ seccion: 2, tipo: 'section' });
    expect(leerManija('S2.L3')).toEqual({ seccion: 2, tipo: 'lesson', numero: 3 });
    expect(leerManija('S2.E1')).toEqual({ seccion: 2, tipo: 'exercise', numero: 1 });
    expect(leerManija('S2.E1.B2')).toEqual({ seccion: 2, tipo: 'block', numero: 1, bloque: 2 });
  });

  it('y las sueltas, sin sección', () => {
    expect(leerManija('L1')).toEqual({ seccion: undefined, tipo: 'lesson', numero: 1 });
    expect(leerManija('E2')).toEqual({ seccion: undefined, tipo: 'exercise', numero: 2 });
  });

  it('no confunde un id ni un texto cualquiera con una manija', () => {
    expect(esManija(ID.leccion1)).toBe(false);
    expect(esManija('lesson-3')).toBe(false);
    expect(esManija('')).toBe(false);
    expect(esUuid(ID.leccion1)).toBe(true);
    expect(esUuid('S2.L3')).toBe(false);
  });
});

describe('el mapa del curso', () => {
  it('numera por `order` y no por el orden en que llegan las filas', () => {
    const m = mapa();

    expect(m.sections.map((s) => [s.manija, s.title])).toEqual([
      ['S1', 'Recepción de pedidos'],
      ['S2', 'Mesa de Ayuda']
    ]);
    expect(m.sections[1].lessons.map((l) => l.manija)).toEqual(['S2.L1', 'S2.L2']);
  });

  /**
   * El desempate es lo que hace que una manija se pueda usar.
   *
   * `getCourseSectionsByCourseId` no tiene ORDER BY y dos secciones pueden
   * compartir `order`. Si el desempate fuera el orden de llegada, `S1` sería una
   * fila distinta en dos llamadas seguidas — peor que no tener manijas.
   */
  it('con dos secciones en el mismo `order`, la manija no depende de cómo lleguen', () => {
    const empatadas: SeccionParaMapa[] = [
      { id: ID.recepcion, title: 'Recepción de pedidos', order: 1, createdAt: '2026-01-01T00:00:00Z' },
      { id: ID.mesaDeAyuda, title: 'Mesa de Ayuda', order: 1, createdAt: '2026-02-01T00:00:00Z' }
    ];

    const enUnOrden = mapaDelCurso(empatadas, []);
    const enElOtro = mapaDelCurso([...empatadas].reverse(), []);

    expect(enUnOrden.sections.map((s) => s.id)).toEqual(enElOtro.sections.map((s) => s.id));
    expect(enUnOrden.idPorManija.get('S1')?.id).toBe(enElOtro.idPorManija.get('S1')?.id);
  });

  it('lo que no está en ninguna sección queda como L1 / E1', () => {
    const m = mapaDelCurso(SECCIONES, [
      ...ITEMS,
      { id: ID.suelta, type: 'LESSON', title: 'Nota suelta', order: 0, sectionId: null },
      { id: ID.ejercicioSuelto, type: 'EXERCISE', title: 'Repaso suelto', order: 0, sectionId: 'seccion-borrada' }
    ]);

    expect(m.unfiled.lessons.map((l) => l.manija)).toEqual(['L1']);
    expect(m.unfiled.exercises.map((e) => e.manija)).toEqual(['E1']);
    expect(resolverEnMapa(m, 'E1', 'exercise')).toBe(ID.ejercicioSuelto);
  });

  it('una lección con diapositivas o video cuenta como escrita', () => {
    const m = mapaDelCurso(SECCIONES, [
      { id: ID.leccion1, type: 'LESSON', title: 'Con video', order: 0, sectionId: ID.recepcion, videosCount: 1 }
    ]);

    expect(m.sections[0].lessons[0].hasContent).toBe(true);
  });

  it('la manija de un id, y un id que no está vuelve tal cual', () => {
    expect(manijaDe(mapa(), ID.leccion3)).toBe('S2.L2');
    expect(manijaDe(mapa(), 'fila-borrada')).toBe('fila-borrada');
  });
});

describe('resolver una manija', () => {
  it('S2.L1 es la primera lección de la segunda sección', () => {
    expect(resolverEnMapa(mapa(), 'S2.L1', 'lesson')).toBe(ID.leccion2);
    expect(resolverEnMapa(mapa(), 'S1.E1', 'exercise')).toBe(ID.ejercicio1);
    expect(resolverEnMapa(mapa(), 'S1', 'section')).toBe(ID.recepcion);
  });

  it('no le importan las mayúsculas', () => {
    expect(resolverEnMapa(mapa(), 's2.l1', 'lesson')).toBe(ID.leccion2);
  });

  it('un id pasa tal cual, esté o no en el mapa', () => {
    expect(resolverEnMapa(mapa(), ID.leccion1, 'lesson')).toBe(ID.leccion1);
    expect(resolverEnMapa(mapa(), '99999999-9999-4999-8999-999999999999', 'lesson')).toBe(
      '99999999-9999-4999-8999-999999999999'
    );
  });

  /**
   * El tipo tiene que decidir: `S1.E1` y `S1.L1` son piezas distintas, y si el
   * tipo no se mirara, pedir una lección devolvería el ejercicio de al lado y el
   * error saldría recién al escribir en la tabla equivocada.
   */
  it('una manija de ejercicio no sirve donde se pide una lección', () => {
    expect(() => resolverEnMapa(mapa(), 'S1.E1', 'lesson')).toThrow(/Unknown lesson "S1.E1"/);
  });

  it('y el error lista lo que sí existe, para corregir en un paso', () => {
    expect(() => resolverEnMapa(mapa(), 'S1.E1', 'lesson')).toThrow(/S1.L1 "Qué se recibe y qué no"/);
    expect(() => resolverEnMapa(mapa(), 'S9.L1', 'lesson')).toThrow(/This course has: S1.L1/);
  });

  it('algo que no es ni manija ni id se rechaza igual', () => {
    expect(() => resolverEnMapa(mapa(), 'lesson-3', 'lesson')).toThrow(/Unknown lesson "lesson-3"/);
  });

  it('un curso sin ejercicios lo dice en vez de listar nada', () => {
    expect(() => resolverEnMapa(mapaDelCurso(SECCIONES, []), 'S1.E1', 'exercise')).toThrow(
      /This course has no exercises yet/
    );
  });
});

describe('los bloques de un ejercicio', () => {
  const BLOQUES = [
    { id: 'eee00002-eeee-4eee-8eee-eeeeeeeeeeee', title: 'Segundo bloque', order: 2, createdAt: '2026-01-02T00:00:00Z' },
    { id: 'eee00001-eeee-4eee-8eee-eeeeeeeeeeee', title: 'Primer bloque', order: 1, createdAt: '2026-01-01T00:00:00Z' }
  ];

  it('B2 es el segundo por `order`, no el segundo que llegó', () => {
    expect(resolverBloque('B2', BLOQUES, 'S1.E1')).toBe('eee00002-eeee-4eee-8eee-eeeeeeeeeeee');
    expect(resolverBloque('S1.E1.B1', BLOQUES, 'S1.E1')).toBe('eee00001-eeee-4eee-8eee-eeeeeeeeeeee');
  });

  it('un id pasa tal cual', () => {
    expect(resolverBloque(BLOQUES[0].id, BLOQUES, 'S1.E1')).toBe(BLOQUES[0].id);
  });

  it('uno que no existe trae la lista de los que hay', () => {
    expect(() => resolverBloque('B7', BLOQUES, 'S1.E1')).toThrow(/S1.E1.B1 "Primer bloque"/);
  });

  it('y un ejercicio sin bloques dice cómo crear uno', () => {
    expect(() => resolverBloque('B1', [], 'S1.E1')).toThrow(/create_exercise_section/);
  });
});

describe('la estructura como la lee el modelo', () => {
  it('cada pieza viene con su manija y con su id', () => {
    const descripcion = describirCurso(mapa());

    expect(descripcion.sections[0]).toMatchObject({ handle: 'S1', id: ID.recepcion, title: 'Recepción de pedidos' });
    expect(descripcion.sections[0].lessons[0]).toMatchObject({ handle: 'S1.L1', id: ID.leccion1 });
    expect(descripcion.sections[0].exercises[0]).toMatchObject({ handle: 'S1.E1', questionCount: 6 });
    expect(descripcion.note).toContain('reorder_content');
  });

  it('las sueltas sólo aparecen si las hay', () => {
    expect(describirCurso(mapa())).not.toHaveProperty('unfiled');
  });
});

describe('el resolutor de la ronda', () => {
  it('carga el mapa una sola vez, y de nuevo después de invalidar', async () => {
    const cargar = vi.fn<[], Promise<MapaDelCurso>>().mockImplementation(async () => mapa());
    const manijas = crearResolutorDeManijas(cargar);

    await manijas.leccion('S1.L1');
    await manijas.ejercicio('S1.E1');
    expect(cargar).toHaveBeenCalledTimes(1);

    manijas.invalidar();
    await manijas.leccion('S1.L1');
    expect(cargar).toHaveBeenCalledTimes(2);
  });

  /** El mapa cuesta dos consultas; un id ya es la respuesta. */
  it('un id no hace cargar el mapa', async () => {
    const cargar = vi.fn<[], Promise<MapaDelCurso>>().mockImplementation(async () => mapa());
    const manijas = crearResolutorDeManijas(cargar);

    expect(await manijas.leccion(ID.leccion1)).toBe(ID.leccion1);
    expect(cargar).not.toHaveBeenCalled();
  });

  /**
   * `manijaDe` contesta con el mapa vigente y no lo refresca sola: si lo
   * hiciera, sacarle el `invalidar()` a una herramienta que crea no cambiaría
   * nada y ningún test podría notar que falta.
   */
  it('`manijaDe` ve lo recién creado después de invalidar, y no antes', async () => {
    let conLaNueva = false;
    const manijas = crearResolutorDeManijas(async () =>
      conLaNueva
        ? mapaDelCurso(SECCIONES, [
            ...ITEMS,
            { id: ID.suelta, type: 'LESSON', title: 'Recién creada', order: 4, sectionId: ID.mesaDeAyuda }
          ])
        : mapa()
    );

    await manijas.mapa();
    conLaNueva = true;

    // El mapa todavía es el viejo: la pieza nueva vuelve como su id.
    expect(await manijas.manijaDe(ID.suelta)).toBe(ID.suelta);

    manijas.invalidar();

    expect(await manijas.manijaDe(ID.suelta)).toBe('S2.L3');
  });
});
