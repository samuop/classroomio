/**
 * La medición de los enlaces que el agente escribe a contenido que no existe.
 *
 * El arreglo para el docente vive en el dashboard (`mentions.ts`), que repara
 * el enlace por título al mostrarlo. Esto sólo mide, en el servidor, cuántas
 * veces pasa y si esa reparación alcanza — que es lo que decide si hace falta
 * atacarlo también en el origen.
 */
import { describe, expect, it } from 'vitest';

import { mencionesRotas } from '@api/services/agent/mention-check';

const REAL = '585f735a-ad92-41ab-9712-b496801abc25';
const INVENTADO = '798ca7a5-cfa9-4416-ba92-f38b813b526f';
const SECCION = '49abea02-ab27-4428-8fdb-6b36657fcde3';

const ITEMS = [
  { id: REAL, type: 'LESSON', title: 'Cómo está organizada la empresa' },
  { id: SECCION, type: 'SECTION', title: 'La empresa por dentro' },
  { id: 'intro-a', type: 'LESSON', title: 'Introducción' },
  { id: 'intro-b', type: 'LESSON', title: 'Introducción' }
];

describe('enlaces a contenido que no existe', () => {
  it('no reporta un enlace bueno', () => {
    expect(mencionesRotas(`Listo: @[Cómo está organizada la empresa](lesson:${REAL})`, ITEMS)).toEqual([]);
  });

  it('reporta el id inventado, y que el título alcanza para repararlo — el caso medido', () => {
    expect(mencionesRotas(`@[Cómo está organizada la empresa](lesson:${INVENTADO})`, ITEMS)).toEqual([
      { titulo: 'Cómo está organizada la empresa', tipo: 'lesson', id: INVENTADO, reparablePorTitulo: true }
    ]);
  });

  it('dice que no es reparable cuando el título no nombra nada', () => {
    const [rota] = mencionesRotas(`@[Otra cosa](lesson:${INVENTADO})`, ITEMS);

    expect(rota.reparablePorTitulo).toBe(false);
  });

  it('dice que no es reparable cuando dos ítems comparten el título', () => {
    const [rota] = mencionesRotas(`@[Introducción](lesson:${INVENTADO})`, ITEMS);

    expect(rota.reparablePorTitulo).toBe(false);
  });

  it('un id real de otro tipo no cuenta como roto: apunta a algo que existe', () => {
    expect(mencionesRotas(`@[Cómo está organizada la empresa](lesson:${SECCION})`, ITEMS)).toEqual([]);
  });

  it('encuentra todas las rotas de un mismo resumen', () => {
    const texto = `@[A](lesson:${INVENTADO}) y @[B](exercise:00000000-0000-0000-0000-000000000000) y @[C](lesson:${REAL})`;

    expect(mencionesRotas(texto, ITEMS).map((r) => r.titulo)).toEqual(['A', 'B']);
  });

  it('no confunde un enlace común con una mención', () => {
    expect(mencionesRotas('[la web](https://ejemplo.example/lesson:123)', ITEMS)).toEqual([]);
  });
});
