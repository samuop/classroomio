/**
 * El escritor de lecciones puede decir que no.
 *
 * ── Por qué importa ──────────────────────────────────────────────────────────
 *
 * Hasta acá sólo podía escribir. Si el material no sostenía la lección, su
 * única salida era escribirla igual y poner el hueco en una nota, que se
 * relataba en prosa y se iba hacia arriba en el chat. O sea: el hueco quedaba
 * tapado con párrafos verosímiles, que es el peor resultado posible porque
 * después nadie puede ver qué parte se inventó. Fue así como se construyó una
 * sección entera sobre un organigrama que el agente nunca había leído.
 *
 * Estos tests fijan el sobre. Si alguien cambia la etiqueta o el orden en que
 * se mira, la negativa vuelve a pasar por una lección normal — vacía — y el
 * fallo vuelve en silencio.
 */
import { describe, expect, it } from 'vitest';

import { extraerLeccion } from '@api/services/agent/lesson-writer';

describe('el escritor puede negarse cuando el material no alcanza', () => {
  it('una negativa se lee como negativa, con su motivo', () => {
    const respuesta =
      '<sin-material>\nEl organigrama muestra los puestos pero no dice de qué se ocupa cada área.\n</sin-material>';

    expect(extraerLeccion(respuesta)).toEqual({
      faltaMaterial: 'El organigrama muestra los puestos pero no dice de qué se ocupa cada área.'
    });
  });

  it('una lección normal sigue leyéndose igual', () => {
    const resultado = extraerLeccion('<lesson><h3>Hola</h3></lesson>');

    expect(resultado).toEqual({ html: '<h3>Hola</h3>' });
  });

  it('y con nota', () => {
    const resultado = extraerLeccion('<lesson><h3>Hola</h3></lesson><note>Falta la parte 2.</note>');

    expect(resultado).toEqual({ html: '<h3>Hola</h3>', nota: 'Falta la parte 2.' });
  });

  /**
   * El orden importa: la negativa se mira ANTES. Un modelo que manda las dos
   * cosas se está negando y además dejó el borrador; guardar ese borrador es
   * exactamente lo que la negativa vino a impedir.
   */
  it('si manda las dos, gana la negativa', () => {
    const resultado = extraerLeccion(
      '<sin-material>No hay material de esto.</sin-material><lesson><h3>Borrador</h3></lesson>'
    );

    expect(resultado).toEqual({ faltaMaterial: 'No hay material de esto.' });
  });

  it('un sobre vacío no se confunde con una negativa', () => {
    expect(extraerLeccion('<sin-material>   </sin-material>')).toBeNull();
    expect(extraerLeccion('<lesson>   </lesson>')).toBeNull();
    expect(extraerLeccion('la respuesta se cortó a mitad')).toBeNull();
  });
});
