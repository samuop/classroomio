/**
 * Leer antes de preguntar.
 *
 * El constructor del curso ya no ve el texto de las lecciones —las escribe
 * `write_lesson`— ni, durante la construcción, las fuentes. Si arma un
 * ejercicio sin leer la lección, las preguntas salen de lo que supone que dice.
 * El servidor lo rechaza, y lo que se fija acá es que el rechazo sea exacto y
 * que lleve directo al paso que lo corrige.
 */
import { describe, expect, it } from 'vitest';

import { avisoLeerAntes, leccionesSinLeer } from '@api/services/agent/exercise-reading';

const A = { id: 'aaaaaaaa-0000-0000-0000-000000000001', title: 'Cómo está organizada la empresa' };
const B = { id: 'aaaaaaaa-0000-0000-0000-000000000002', title: 'Elementos de protección personal' };

describe('qué falta leer', () => {
  it('nada, cuando se leyeron todas', () => {
    expect(leccionesSinLeer([A, B], new Set([A.id, B.id]))).toEqual([]);
  });

  it('las que faltan, en el orden de la sección', () => {
    expect(leccionesSinLeer([A, B], new Set([A.id]))).toEqual([B]);
    expect(leccionesSinLeer([A, B], new Set())).toEqual([A, B]);
  });

  it('nada, cuando el ejercicio no cubre ninguna lección', () => {
    // El examen final vive en una sección sin lecciones: sin contra qué
    // comparar, el control no rechaza (lo cubre el prompt).
    expect(leccionesSinLeer([], new Set())).toEqual([]);
  });
});

describe('el rechazo', () => {
  const aviso = avisoLeerAntes([A, B]);

  it('dice que no se creó nada', () => {
    expect(aviso).toMatch(/^Nothing was created\./);
  });

  it('nombra las lecciones por título y por id', () => {
    expect(aviso).toContain(A.title);
    expect(aviso).toContain(B.id);
  });

  it('trae el array de ids listo para read_lessons, así corregirlo es un paso', () => {
    expect(aviso).toContain(`read_lessons with lessonIds ${JSON.stringify([A.id, B.id])}`);
  });

  it('dice por qué, no sólo qué', () => {
    expect(aviso).toMatch(/what a lesson actually says, not what you expect it to say/);
  });
});
