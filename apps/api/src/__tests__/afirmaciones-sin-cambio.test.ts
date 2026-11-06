/**
 * Lo que el mensaje dice haber cambiado, contra lo que el servidor vio.
 *
 * El caso medido (2026-11), con otros nombres: la docente pidió actualizar los
 * cuestionarios. El modelo editó una lección, no tocó ninguna pregunta, y cerró
 * con «se actualizaron las preguntas del cuestionario y del examen final». El
 * registro de la ronda decía sólo «Editó» sobre la lección.
 */
import { describe, expect, it } from 'vitest';

import { afirmacionesSinCambio, hayAfirmacionesSinCambio } from '@api/services/agent/afirmaciones-sin-cambio';

const TITULOS = ['Controlar precios en góndola', 'Cuestionario de precios y salón', 'Examen final integrador', 'Recibir mercadería'];

const CIERRE_MEDIDO = [
  'Listo, actualicé el protocolo de control en @[Controlar precios en góndola](lesson:S3.L1):',
  '- **Criterio de muestreo:** se ajustó para que los 10 productos salgan del listado del sistema.',
  '- **Evaluaciones asociadas:** se actualizaron las preguntas del @[Cuestionario de precios y salón](exercise:S3.E1) y del @[Examen final integrador](exercise:S6.E1).'
].join('\n');

describe('el relato contra el registro', () => {
  it('el caso medido: la lección sí cambió, los dos cuestionarios no', () => {
    const resultado = afirmacionesSinCambio({
      texto: CIERRE_MEDIDO,
      cambiadas: ['Controlar precios en góndola'],
      cambioPreguntas: false,
      titulosDelCurso: TITULOS
    });

    expect(resultado.piezas).toEqual(['Cuestionario de precios y salón', 'Examen final integrador']);
    expect(hayAfirmacionesSinCambio(resultado)).toBe(true);
  });

  it('si la ronda sí cambió esas preguntas, no hay nada que advertir', () => {
    const resultado = afirmacionesSinCambio({
      texto: CIERRE_MEDIDO,
      cambiadas: ['Controlar precios en góndola', 'Cuestionario de precios y salón', 'Examen final integrador'],
      cambioPreguntas: true,
      titulosDelCurso: TITULOS
    });

    expect(hayAfirmacionesSinCambio(resultado)).toBe(false);
  });

  it('una pieza nombrada por su título, sin enlace, también cuenta', () => {
    const resultado = afirmacionesSinCambio({
      texto: 'Corregí la lección Recibir mercadería para que diga el horario nuevo.',
      cambiadas: [],
      cambioPreguntas: false,
      titulosDelCurso: TITULOS
    });

    expect(resultado.piezas).toEqual(['Recibir mercadería']);
  });

  it('«actualicé los cuestionarios» sin decir cuáles, en una ronda que no tocó preguntas', () => {
    const resultado = afirmacionesSinCambio({
      texto: 'Ya están actualizados los cuestionarios con el criterio nuevo.',
      cambiadas: ['Controlar precios en góndola'],
      cambioPreguntas: false,
      titulosDelCurso: TITULOS
    });

    expect(resultado).toEqual({ piezas: [], preguntas: true });
  });

  it('nombrar sin afirmar un cambio no advierte nada: un plan, una pregunta, un futuro', () => {
    const resultado = afirmacionesSinCambio({
      texto: [
        'Voy a actualizar @[Cuestionario de precios y salón](exercise:S3.E1) en el próximo paso.',
        '¿Querés que revise también el @[Examen final integrador](exercise:S6.E1)?',
        'La lección @[Recibir mercadería](lesson:S1.L2) ya decía lo correcto.'
      ].join('\n'),
      cambiadas: [],
      cambioPreguntas: false,
      titulosDelCurso: TITULOS
    });

    expect(hayAfirmacionesSinCambio(resultado)).toBe(false);
  });

  it('no confunde mayúsculas ni tildes al comparar con lo cambiado', () => {
    const resultado = afirmacionesSinCambio({
      texto: 'Actualicé @[controlar precios en gondola](lesson:S3.L1).',
      cambiadas: ['Controlar precios en góndola'],
      cambioPreguntas: false,
      titulosDelCurso: TITULOS
    });

    expect(hayAfirmacionesSinCambio(resultado)).toBe(false);
  });
});
