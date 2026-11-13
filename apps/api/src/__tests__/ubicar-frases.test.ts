import { describe, expect, it } from 'vitest';

import { buscarEnLecciones, buscarEnLeccionesConResto, MAX_POR_LECCION } from '@api/services/agent/lesson-search';
import {
  bloquesQueAfirman,
  frasesFueraDelPlan,
  ubicarFrases,
  type FraseUbicada,
  type Incrustador
} from '@api/services/agent/ubicar-frases';

/**
 * Encontrar en el curso la frase que la docente señaló.
 *
 * Medido el 2026-11-13: «corregí eso» sobre cinco frases dejó una sin corregir
 * en dos corridas de tres. En una el asistente no la buscó; en la otra buscó
 * una palabra que la lección usa en veinte párrafos, recibió tres que no eran,
 * y corrigió otra lección. El cierre decía «implementé los ajustes».
 *
 * Curso inventado, de un depósito que no existe.
 */

/**
 * Un incrustador de juguete: cuenta palabras. Dos textos se parecen cuanto más
 * palabras comparten, que alcanza para probar el orden sin llamar a nadie.
 */
const PALABRAS_VACIAS = new Set(['la', 'el', 'de', 'del', 'en', 'se', 'que', 'una', 'un', 'al', 'los', 'las', 'por', 'es', 'y', 'a', 'con']);
const incrustarDeJuguete: Incrustador = async (textos) =>
  textos.map((texto) => {
    const vector = new Array<number>(64).fill(0);

    for (const palabra of texto.toLowerCase().normalize('NFD').replace(/[^a-z0-9 ]/g, ' ').split(/\s+/)) {
      if (palabra.length < 2 || PALABRAS_VACIAS.has(palabra)) continue;

      let hash = 0;

      for (const letra of palabra) hash = (hash * 31 + letra.charCodeAt(0)) % 64;

      vector[hash] += 1;
    }

    return vector;
  });

/** Una lección que nombra el «cambio de guardia» en muchos párrafos; la frase equivocada está en el último. */
const CAMBIO_DE_GUARDIA = {
  id: 'guardia',
  title: 'El cambio de guardia',
  content:
    '<h3 data-block-id="t0">El cambio de guardia y el pedido recibido</h3>' +
    Array.from(
      { length: 11 },
      (_, i) => `<p data-block-id="t${i + 1}">En el cambio de guardia número ${i + 1} se revisa la limpieza del depósito y el orden de las estanterías del sector.</p>`
    ).join('') +
    '<p data-block-id="t12">El único pedido que puede quedar sin registrar es el recibido en esa misma guardia, cuando la descarga coincide con el cambio de guardia.</p>'
};

const PEDIDOS = {
  id: 'pedidos',
  title: 'El retiro semanal de pedidos',
  content:
    '<p data-block-id="b1">Los pedidos se retiran los lunes y los viernes por la mañana, antes de las ocho.</p>' +
    '<p data-block-id="b2">Un pedido puede quedar sin registrar cuando el proveedor lo entrega ese día.</p>'
};

const BALANZA = {
  id: 'balanza',
  title: 'Bultos por peso',
  content:
    '<p data-block-id="c1">Cuando la suma de los bultos no coincide con la planilla, se anota solamente el peso real que entró a la cámara.</p>' +
    '<p data-block-id="c2">Cada bulto trae su rótulo con el peso exacto, con decimales.</p>'
};

const SIN_IDS = {
  id: 'vieja',
  title: 'Lección escrita antes de los ids',
  content: '<h3>Avisos</h3><p>Los avisos de mercadería mal entregada se hacen solamente por el canal general del sector.</p>'
};

const CURSO = [CAMBIO_DE_GUARDIA, PEDIDOS, BALANZA, SIN_IDS];
const FRASE_DE_LA_GUARDIA = 'Sólo puede quedar sin registrar un pedido recibido en esa misma guardia, a la hora del cambio de guardia';

describe('el buscador literal, con palabras que la lección repite', () => {
  it('lo que hacía el asistente: buscar «cambio de guardia» no trae el párrafo del error', () => {
    const encontrados = buscarEnLecciones({ lecciones: CURSO, texto: 'cambio de guardia' });

    expect(encontrados).toHaveLength(MAX_POR_LECCION);
    expect(encontrados.map((c) => c.blockId)).not.toContain('t12');
  });

  it('pero ahora dice cuántas apariciones quedaron sin mostrar, y en qué lección', () => {
    const { coincidencias, sinMostrar } = buscarEnLeccionesConResto({ lecciones: CURSO, texto: 'cambio de guardia' });

    // Trece apariciones: el título, once párrafos y el del error.
    expect(sinMostrar).toEqual([{ lessonId: 'guardia', title: 'El cambio de guardia', cantidad: 13 - coincidencias.length }]);
  });

  it('una búsqueda que entra entera no avisa nada', () => {
    expect(buscarEnLeccionesConResto({ lecciones: CURSO, texto: 'camara' }).sinMostrar).toEqual([]);
  });

  it('las lecciones que quedan después del tope total también se cuentan', () => {
    const muchas = Array.from({ length: 6 }, (_, i) => ({ id: `l${i}`, title: `L${i}`, content: '<p>La guardia.</p><p>Otra guardia.</p>' }));
    const { coincidencias, sinMostrar } = buscarEnLeccionesConResto({ lecciones: muchas, texto: 'guardia', maxTotal: 4 });

    expect(coincidencias).toHaveLength(4);
    expect(sinMostrar.map((resto) => [resto.lessonId, resto.cantidad])).toEqual([
      ['l2', 2],
      ['l3', 2],
      ['l4', 2],
      ['l5', 2]
    ]);
  });
});

describe('ubicar la frase entera', () => {
  it('trae primero el párrafo que la dice, con su lección y su bloque', async () => {
    const [ubicada] = (await ubicarFrases({ frases: [FRASE_DE_LA_GUARDIA], lecciones: CURSO, incrustar: incrustarDeJuguete })) as FraseUbicada[];

    expect(ubicada.statement).toBe(FRASE_DE_LA_GUARDIA);
    expect(ubicada.passages[0]).toMatchObject({ lessonId: 'guardia', blockId: 't12' });
    expect(ubicada.passages[0].text).toContain('recibido en esa misma guardia');
    expect(ubicada.passages).toHaveLength(3);
  });

  it('ubica varias frases de una vez, cada una con lo suyo', async () => {
    const ubicadas = (await ubicarFrases({
      frases: [FRASE_DE_LA_GUARDIA, 'Si la suma de los bultos no coincide con la planilla se anota el peso real'],
      lecciones: CURSO,
      incrustar: incrustarDeJuguete
    })) as FraseUbicada[];

    expect(ubicadas.map((frase) => frase.passages[0].blockId)).toEqual(['t12', 'c1']);
  });

  it('un título no cuenta: se parece a cualquier frase del tema y no afirma nada', async () => {
    // El título de la lección comparte más palabras con la frase que varios
    // párrafos; aun así no puede salir entre los pasajes.
    const [ubicada] = (await ubicarFrases({ frases: [FRASE_DE_LA_GUARDIA], lecciones: CURSO, incrustar: incrustarDeJuguete })) as FraseUbicada[];

    expect(bloquesQueAfirman(CAMBIO_DE_GUARDIA).map((bloque) => bloque.blockId)).not.toContain('t0');
    expect(ubicada.passages.map((pasaje) => pasaje.blockId)).not.toContain('t0');
  });

  it('una lección sin ids de bloque se ubica igual, sin bloque', async () => {
    const [ubicada] = (await ubicarFrases({
      frases: ['Los avisos de mercadería mal entregada se hacen por el canal general'],
      lecciones: CURSO,
      incrustar: incrustarDeJuguete
    })) as FraseUbicada[];

    expect(ubicada.passages[0].lessonId).toBe('vieja');
    expect(ubicada.passages[0].blockId).toBeUndefined();
  });

  it('si no se pudo incrustar devuelve null, que no es lo mismo que «el curso no lo dice»', async () => {
    expect(await ubicarFrases({ frases: [FRASE_DE_LA_GUARDIA], lecciones: CURSO, incrustar: async () => null })).toBeNull();
  });

  it('un curso sin texto devuelve la frase sin pasajes', async () => {
    expect(await ubicarFrases({ frases: [FRASE_DE_LA_GUARDIA], lecciones: [], incrustar: incrustarDeJuguete })).toEqual([
      { statement: FRASE_DE_LA_GUARDIA, passages: [] }
    ]);
  });
});

describe('el plan de cambios contra las frases ubicadas', () => {
  const ubicadas: FraseUbicada[] = [
    {
      statement: FRASE_DE_LA_GUARDIA,
      passages: [
        { lessonId: 'guardia', title: 'El cambio de guardia', blockId: 't12', text: '…recibido en esa misma guardia…', similarity: 0.84 },
        { lessonId: 'pedidos', title: 'El retiro semanal de pedidos', blockId: 'b2', text: '…ese día.', similarity: 0.82 }
      ]
    },
    {
      statement: 'Los repuestos importados son artículos críticos',
      passages: [{ lessonId: 'categorias', title: 'Categorías críticas', blockId: 'k1', text: '…', similarity: 0.72 }]
    }
  ];

  it('el plan que falló: toca la segunda lección más parecida y deja la de la frase', () => {
    const fuera = frasesFueraDelPlan({ ubicadas, tocados: new Set(['pedidos', 'categorias']) });

    expect(fuera).toHaveLength(1);
    expect(fuera[0].statement).toBe(FRASE_DE_LA_GUARDIA);
    expect(fuera[0].passage).toMatchObject({ lessonId: 'guardia', blockId: 't12' });
  });

  it('un plan que nombra la lección de cada frase pasa', () => {
    expect(frasesFueraDelPlan({ ubicadas, tocados: new Set(['guardia', 'categorias']) })).toEqual([]);
  });

  it('sin frases ubicadas en la ronda no reclama nada', () => {
    expect(frasesFueraDelPlan({ ubicadas: [], tocados: new Set() })).toEqual([]);
  });

  it('una frase que no encontró ningún pasaje no bloquea el plan', () => {
    expect(frasesFueraDelPlan({ ubicadas: [{ statement: 'x', passages: [] }], tocados: new Set() })).toEqual([]);
  });
});
