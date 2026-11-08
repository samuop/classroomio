/**
 * Lo que el mensaje dice haber cambiado, contra lo que el servidor vio.
 *
 * El caso medido (2026-11), con otros nombres: la docente pidió actualizar los
 * cuestionarios. El modelo editó una lección, no tocó ninguna pregunta, y cerró
 * con «se actualizaron las preguntas del cuestionario y del examen final». El
 * registro de la ronda decía sólo «Editó» sobre la lección.
 */
import { describe, expect, it } from 'vitest';

import { afirmacionesSinCambio, hayAfirmacionesSinCambio, piezasCambiadas } from '@api/services/agent/afirmaciones-sin-cambio';

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

  it.each([
    ['el subjuntivo, que sin tilde se escribe igual', 'Si querés, actualice las preguntas del cuestionario más tarde.'],
    ['una oferta en pregunta', '¿Querés que actualice las preguntas del @[Examen final integrador](exercise:S6.E1)?'],
    ['«cree», de creer', 'El modelo cree que las preguntas del examen siguen bien.'],
    ['una negación antes del verbo', 'No actualicé las preguntas del cuestionario: no me lo pediste.'],
    ['la negación con un pronombre en el medio', 'Todavía no las modifiqué, las preguntas siguen como antes.'],
    ['la pasiva negada', 'Las preguntas del examen no fueron modificadas.'],
    ['el impersonal negado', 'No se actualizaron las preguntas en esta ronda.'],
    ['el impersonal en futuro', 'Cuando apruebes, se actualizarán las preguntas del examen.'],
    ['el impersonal en subjuntivo', 'Avisame si querés que se actualicen los cuestionarios.'],
    ['«pero» separa lo hecho de lo no hecho', 'Corregí la lección Controlar precios en góndola, pero no toqué el examen.'],
    ['lo pendiente después del «pero»', 'Corregí el ejemplo del cálculo, pero las preguntas siguen pendientes.'],
    ['una pregunta con participio', '¿Ya están actualizadas las preguntas del cuestionario, o preferís revisarlas?'],
    ['una «y no» después','Corregí la lección Controlar precios en góndola y no toqué el examen.'],
    ['las preguntas que quedaron igual', 'Agregué un ejemplo nuevo y las preguntas quedaron igual.'],
    ['otra ronda', 'En la ronda anterior actualicé las preguntas del @[Examen final integrador](exercise:S6.E1).'],
    ['inglés negado', "I haven't updated the questions of the quiz yet."],
    ['inglés en futuro', 'The questions will be updated once you approve.'],
    ['un título como frase común, en minúscula', 'Agregué un ejemplo para controlar precios en góndola cuando falta la etiqueta.'],
    ['una pieza nombrada con negación', 'Corregí @[Controlar precios en góndola](lesson:S3.L1) y no toqué @[Recibir mercadería](lesson:S1.L2).'],
    ['revisar no es cambiar', 'Revisé @[Recibir mercadería](lesson:S1.L2) y @[Controlar precios en góndola](lesson:S3.L1) quedó actualizada.'],
    ['un «no» de la cláusula anterior no niega', 'Si no te gusta, cambié el ejemplo de @[Controlar precios en góndola](lesson:S3.L1).']
  ])('no advierte: %s', (_caso, texto) => {
    const resultado = afirmacionesSinCambio({
      texto,
      cambiadas: ['Controlar precios en góndola'],
      cambioPreguntas: false,
      titulosDelCurso: TITULOS
    });

    expect(resultado).toEqual({ piezas: [], preguntas: false });
  });

  it.each([
    ['la frase medida, impersonal', 'Se actualizaron las preguntas del cuestionario.', { piezas: [], preguntas: true }],
    ['con la pasiva', 'Las preguntas del examen quedaron actualizadas con el criterio nuevo.', { piezas: [], preguntas: true }],
    ['con «han sido»', 'Las preguntas han sido corregidas.', { piezas: [], preguntas: true }],
    ['«no sólo» no niega', 'No sólo corregí la lección: también actualicé las preguntas.', { piezas: [], preguntas: true }],
    ['lo hecho, antes del «pero»', 'Actualicé las preguntas del cuestionario, pero no agregué ninguna.', { piezas: [], preguntas: true }],
    ['lo afirmado después de lo negado', 'No cambié la lección y actualicé las preguntas del cuestionario.', { piezas: [], preguntas: true }],
    ['inglés', 'I updated the questions of the quiz.', { piezas: [], preguntas: true }],
    ['inglés con «have been»', 'The questions have been updated.', { piezas: [], preguntas: true }],
    [
      'la pieza de la pasiva, y no la revisada',
      'Revisé @[Controlar precios en góndola](lesson:S3.L1) y @[Recibir mercadería](lesson:S1.L2) quedó actualizada.',
      { piezas: ['Recibir mercadería'], preguntas: false }
    ],
    [
      'una lista de enlaces, todas afirmadas',
      'Actualicé @[Recibir mercadería](lesson:S1.L2), @[Cuestionario de precios y salón](exercise:S3.E1) y @[Examen final integrador](exercise:S6.E1).',
      { piezas: ['Recibir mercadería', 'Cuestionario de precios y salón', 'Examen final integrador'], preguntas: false }
    ],
    [
      'un título que empieza la frase, con su mayúscula',
      'Recibir mercadería quedó actualizada con el horario nuevo.',
      { piezas: ['Recibir mercadería'], preguntas: false }
    ]
  ])('advierte: %s', (_caso, texto, esperado) => {
    const resultado = afirmacionesSinCambio({
      texto,
      cambiadas: ['Controlar precios en góndola'],
      cambioPreguntas: false,
      titulosDelCurso: TITULOS
    });

    expect(resultado).toEqual(esperado);
  });

  it('un título que contiene a otro cuenta una vez, el más largo', () => {
    const resultado = afirmacionesSinCambio({
      texto: 'Corregí la lección Recibir mercadería en depósito con el remito nuevo.',
      cambiadas: [],
      cambioPreguntas: false,
      titulosDelCurso: [...TITULOS, 'Recibir mercadería en depósito']
    });

    expect(resultado.piezas).toEqual(['Recibir mercadería en depósito']);
  });

  it('un título con puntos dentro del enlace no parte la frase', () => {
    const resultado = afirmacionesSinCambio({
      texto: 'Actualicé @[Unidad 2. Precios y etiquetas](lesson:S2.L1) y quedó lista.',
      cambiadas: [],
      cambioPreguntas: false,
      titulosDelCurso: ['Unidad 2. Precios y etiquetas']
    });

    expect(resultado.piezas).toEqual(['Unidad 2. Precios y etiquetas']);
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

describe('lo propuesto no cuenta como cambiado', () => {
  // Medido en vivo (2026-11-08): el examen tenía entregas, así que el cambio
  // quedó propuesto y el examen siguió igual. El modelo cerró con esto.
  const CIERRE = 'Listo, sumé las preguntas sobre cobro y facturación al @[Examen final integrador](exercise:S6.E1).';

  it('«sumé las preguntas al examen» sobre una propuesta sale con la advertencia', () => {
    const resultado = afirmacionesSinCambio({
      texto: CIERRE,
      cambiadas: piezasCambiadas({ cambios: [{ accion: 'propuso', objeto: 'Examen final integrador' }], escriturasHechas: [] }),
      cambioPreguntas: false,
      titulosDelCurso: TITULOS
    });

    expect(resultado.piezas).toEqual(['Examen final integrador']);
  });

  it('lo creado, editado o enmendado sí cuenta, y lo que la bitácora vio guardar también', () => {
    expect(
      piezasCambiadas({
        cambios: [
          { accion: 'edito', objeto: 'Recibir mercadería' },
          { accion: 'propuso', objeto: 'Examen final integrador' },
          { accion: 'creo', objeto: 'Cuestionario de precios y salón' }
        ],
        escriturasHechas: [{ titulo: 'Controlar precios en góndola' }, {}]
      })
    ).toEqual(['Recibir mercadería', 'Cuestionario de precios y salón', 'Controlar precios en góndola']);
  });
});
