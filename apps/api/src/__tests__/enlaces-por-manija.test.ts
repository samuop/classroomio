import { describe, expect, it, vi } from 'vitest';
import { ContentType } from '@cio/utils/constants';
import { mapaDelCurso } from '@api/services/agent/manijas';
import {
  cortarEnElBorde,
  repararEnlaces,
  transformarEnlacesDelChat,
  type CursoParaEnlaces
} from '@api/services/agent/enlaces-del-chat';

/**
 * Los enlaces del chat, por manija.
 *
 * ── Qué se midió ─────────────────────────────────────────────────────────────
 *
 * 2026-09-22: tres UUIDs inventados en los enlaces de un solo resumen. No es
 * descuido — desde que las herramientas devuelven manijas y ya casi no
 * devuelven ids, el modelo no tiene de dónde copiar un UUID, y el formato del
 * enlace le pedía uno igual. El servidor lo registraba y guardaba el texto con
 * el id malo.
 *
 * Lo que se fija:
 *   1. una manija se traduce al id real;
 *   2. un id inventado, con un título que nombra una sola pieza, se repara;
 *   3. sin título que coincida, el enlace queda en TEXTO PLANO — un enlace que
 *      no lleva a ningún lado miente dos veces;
 *   4. un enlace partido entre dos trozos del stream se traduce igual.
 *
 * Curso inventado, de una mesa de ayuda que no existe.
 */

const ID = {
  seccion: '11111111-1111-4111-8111-111111111111',
  quienAtiende: 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  comoSeCierra: 'aaaaaaa2-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  autoevaluacion: 'bbbbbbb1-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  inventado: '63f84ceb-1234-4321-8888-999999999999'
};

const SECCIONES = [{ id: ID.seccion, title: 'Mesa de Ayuda', order: 0, createdAt: '2026-01-02T00:00:00Z' }];

const ITEMS = [
  {
    id: ID.quienAtiende,
    type: ContentType.Lesson,
    title: 'Quién atiende cada reclamo',
    sectionId: ID.seccion,
    order: 0
  },
  {
    id: ID.comoSeCierra,
    type: ContentType.Lesson,
    title: 'Cómo se cierra un reclamo',
    sectionId: ID.seccion,
    order: 1
  },
  {
    id: ID.autoevaluacion,
    type: ContentType.Exercise,
    title: 'Autoevaluación de la mesa',
    sectionId: ID.seccion,
    order: 2
  }
];

const CURSO: CursoParaEnlaces = { mapa: mapaDelCurso(SECCIONES, ITEMS), items: ITEMS };

describe('resolver los enlaces de un mensaje', () => {
  it('una manija se traduce al id real', () => {
    const { texto, cambios } = repararEnlaces('Escribí @[Quién atiende cada reclamo](lesson:S1.L1).', CURSO);

    expect(texto).toBe(`Escribí @[Quién atiende cada reclamo](lesson:${ID.quienAtiende}).`);
    expect(cambios).toMatchObject([{ como: 'handle' }]);
  });

  it('también para ejercicios y secciones', () => {
    const { texto } = repararEnlaces(
      'Mirá @[Autoevaluación de la mesa](exercise:S1.E1) dentro de @[Mesa de Ayuda](section:S1).',
      CURSO
    );

    expect(texto).toContain(`exercise:${ID.autoevaluacion}`);
    expect(texto).toContain(`section:${ID.seccion}`);
  });

  it('un id de verdad no se toca', () => {
    const original = `Mirá @[Cómo se cierra un reclamo](lesson:${ID.comoSeCierra}).`;
    const { texto, cambios } = repararEnlaces(original, CURSO);

    expect(texto).toBe(original);
    expect(cambios).toEqual([]);
  });

  it('un UUID inventado con un título que existe se repara por título', () => {
    const { texto, cambios } = repararEnlaces(`Ver @[Cómo se cierra un reclamo](lesson:${ID.inventado}).`, CURSO);

    expect(texto).toBe(`Ver @[Cómo se cierra un reclamo](lesson:${ID.comoSeCierra}).`);
    expect(cambios).toMatchObject([{ como: 'title' }]);
  });

  /** Tildes y mayúsculas no cambian de qué lección se habla; «Organigrama 2023» sí. */
  it('el título se compara sin tildes ni mayúsculas', () => {
    const { texto } = repararEnlaces(`Ver @[COMO SE CIERRA UN RECLAMO](lesson:${ID.inventado}).`, CURSO);

    expect(texto).toContain(`lesson:${ID.comoSeCierra}`);
  });

  it('sin título que coincida, el enlace queda como texto plano', () => {
    const { texto, cambios } = repararEnlaces(`Ver @[Política de devoluciones](lesson:${ID.inventado}).`, CURSO);

    expect(texto).toBe('Ver Política de devoluciones.');
    expect(texto).not.toContain(ID.inventado);
    expect(texto).not.toContain('@[');
    expect(cambios).toMatchObject([{ como: 'dropped' }]);
  });

  /** Un título repetido es una adivinanza; adivinar sería peor que no enlazar. */
  it('dos piezas con el mismo título no se adivinan', () => {
    const repetidas = [...ITEMS, { ...ITEMS[1], id: 'aaaaaaa9-aaaa-4aaa-8aaa-aaaaaaaaaaaa', order: 3 }];
    const { texto } = repararEnlaces(`Ver @[Cómo se cierra un reclamo](lesson:${ID.inventado}).`, {
      mapa: mapaDelCurso(SECCIONES, repetidas),
      items: repetidas
    });

    expect(texto).toBe('Ver Cómo se cierra un reclamo.');
  });

  it('una manija de otro tipo no vale como enlace de lección', () => {
    const { texto } = repararEnlaces('Ver @[Autoevaluación de la mesa](lesson:S1.E1).', CURSO);

    // No resuelve como lección; tampoco hay una LECCIÓN con ese título.
    expect(texto).toBe('Ver Autoevaluación de la mesa.');
  });

  it('un texto sin enlaces no se toca', () => {
    const original = 'Listo: actualicé las dos lecciones de la sección.';

    expect(repararEnlaces(original, CURSO).texto).toBe(original);
  });
});

describe('dónde se puede cortar el texto que llega en trozos', () => {
  it('retiene desde un enlace que todavía no cerró', () => {
    expect(cortarEnElBorde('Listo. Ver @[Quién at')).toEqual({ listo: 'Listo. Ver ', pendiente: '@[Quién at' });
    expect(cortarEnElBorde('Listo. Ver @[Quién atiende](lesson:S1')).toEqual({
      listo: 'Listo. Ver ',
      pendiente: '@[Quién atiende](lesson:S1'
    });
  });

  it('un enlace completo no retiene nada', () => {
    expect(cortarEnElBorde('Ver @[Quién atiende](lesson:S1.L1) y listo.')).toEqual({
      listo: 'Ver @[Quién atiende](lesson:S1.L1) y listo.',
      pendiente: ''
    });
  });

  /**
   * Medido con el texto real de una ronda cortado de a 7 y de a 23 caracteres:
   * los trozos que terminaban justo en la `@` o justo en el `]` se emitían, y el
   * enlace quedaba partido en dos emisiones que ninguna búsqueda ve entero.
   */
  it('retiene también la @ sola y el título cerrado sin paréntesis', () => {
    expect(cortarEnElBorde('Ver @')).toEqual({ listo: 'Ver ', pendiente: '@' });
    expect(cortarEnElBorde('Ver @[Quién atiende]')).toEqual({ listo: 'Ver ', pendiente: '@[Quién atiende]' });
    expect(cortarEnElBorde('Ver @[Quién atiende](')).toEqual({ listo: 'Ver ', pendiente: '@[Quién atiende](' });
  });
});

/** Las partes del stream, como las manda el AI SDK. */
type Parte = { type: string; id?: string; text?: string };

async function pasarPorLaTransformacion(partes: Parte[], cargar = vi.fn(async () => CURSO)) {
  const transformar = transformarEnlacesDelChat(cargar);
  const stream = new ReadableStream<Parte>({
    start(controller) {
      for (const parte of partes) controller.enqueue(parte);
      controller.close();
    }
  }).pipeThrough(transformar({ tools: {}, stopStream: () => {} }) as unknown as TransformStream<Parte, Parte>);

  const salida: Parte[] = [];

  for await (const parte of stream as unknown as AsyncIterable<Parte>) salida.push(parte);

  return { salida, cargar };
}

describe('la traducción sobre el texto que sale en trozos', () => {
  it('traduce un enlace partido entre tres trozos', async () => {
    const { salida } = await pasarPorLaTransformacion([
      { type: 'text-start', id: 't1' },
      { type: 'text-delta', id: 't1', text: 'Listo. Ver @[Quién atiende' },
      { type: 'text-delta', id: 't1', text: ' cada reclamo](lesson:' },
      { type: 'text-delta', id: 't1', text: 'S1.L1) y nada más.' },
      { type: 'text-end', id: 't1' }
    ]);

    const texto = salida
      .filter((parte) => parte.type === 'text-delta')
      .map((parte) => parte.text)
      .join('');

    expect(texto).toBe(`Listo. Ver @[Quién atiende cada reclamo](lesson:${ID.quienAtiende}) y nada más.`);
    // Y el cierre sigue estando, después del texto.
    expect(salida[salida.length - 1]).toMatchObject({ type: 'text-end' });
  });

  /**
   * Medido en producción: Gemini cierra un bloque de texto y abre otro entre
   * trozos, así que un enlace también cae partido entre DOS bloques. Con un
   * buffer por bloque que se volcaba en cada `text-end`, 8 de 8 enlaces de una
   * ronda quedaron sin traducir.
   */
  it('traduce un enlace partido entre dos bloques de texto, y cierra el primero antes de abrir el segundo', async () => {
    const { salida } = await pasarPorLaTransformacion([
      { type: 'text-start', id: 't1' },
      { type: 'text-delta', id: 't1', text: 'Listo. Ver @[Quién atiende' },
      { type: 'text-end', id: 't1' },
      { type: 'text-start', id: 't2' },
      { type: 'text-delta', id: 't2', text: ' cada reclamo](lesson:S1.L1) y nada más.' },
      { type: 'text-end', id: 't2' }
    ]);

    const texto = salida
      .filter((parte) => parte.type === 'text-delta')
      .map((parte) => parte.text)
      .join('');

    expect(texto).toBe(`Listo. Ver @[Quién atiende cada reclamo](lesson:${ID.quienAtiende}) y nada más.`);
    // El orden de las marcas se respeta: el primer bloque cierra antes de que
    // abra el segundo, y lo retenido viaja con el segundo.
    expect(salida.map((parte) => `${parte.type}${parte.id ? ':' + parte.id : ''}`)).toEqual([
      'text-start:t1',
      'text-delta:t1',
      'text-end:t1',
      'text-start:t2',
      'text-delta:t2',
      'text-end:t2'
    ]);
    expect(salida.filter((parte) => parte.type === 'text-delta' && parte.id === 't2')[0].text).toContain(
      '@[Quién atiende cada reclamo]'
    );
  });

  it('un cierre retenido sale, con lo retenido antes, cuando lo que sigue no es texto', async () => {
    const { salida } = await pasarPorLaTransformacion([
      { type: 'text-start', id: 't1' },
      { type: 'text-delta', id: 't1', text: 'Ver @[Quién at' },
      { type: 'text-end', id: 't1' },
      { type: 'finish' }
    ]);

    expect(salida.map((parte) => parte.type)).toEqual(['text-start', 'text-delta', 'text-delta', 'text-end', 'finish']);
    expect(salida[2]).toMatchObject({ type: 'text-delta', id: 't1', text: '@[Quién at' });
  });

  it('lo retenido sale aunque el bloque de texto nunca cierre', async () => {
    const { salida } = await pasarPorLaTransformacion([
      { type: 'text-start', id: 't1' },
      { type: 'text-delta', id: 't1', text: 'Casi: @[Quién atiende' },
      { type: 'finish' }
    ]);

    const texto = salida
      .filter((parte) => parte.type === 'text-delta')
      .map((parte) => parte.text)
      .join('');

    expect(texto).toBe('Casi: @[Quién atiende');
    expect(salida[salida.length - 1]).toMatchObject({ type: 'finish' });
  });

  /** Dos consultas por ronda para nada: la enorme mayoría no escribe un enlace. */
  it('sin enlaces, el curso no se carga', async () => {
    const { cargar } = await pasarPorLaTransformacion([
      { type: 'text-start', id: 't1' },
      { type: 'text-delta', id: 't1', text: 'Listo: actualicé las dos lecciones.' },
      { type: 'text-end', id: 't1' }
    ]);

    expect(cargar).not.toHaveBeenCalled();
  });

  it('si el curso no se puede leer, el texto sale igual', async () => {
    const roto = vi.fn(async () => {
      throw new Error('la base no contesta');
    });
    const { salida } = await pasarPorLaTransformacion(
      [
        { type: 'text-start', id: 't1' },
        { type: 'text-delta', id: 't1', text: 'Ver @[Quién atiende cada reclamo](lesson:S1.L1).' },
        { type: 'text-end', id: 't1' }
      ],
      roto as never
    );

    expect(salida.find((parte) => parte.type === 'text-delta')?.text).toContain('@[Quién atiende cada reclamo]');
  });
});
