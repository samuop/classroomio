/**
 * Las preguntas cuyo fundamento ya no está en las lecciones.
 *
 * El caso medido (2026-11), con otros datos: una lección cambió el criterio de
 * un control («10 productos al azar» pasó a «10 productos del listado de
 * cambios del sistema») y el cuestionario siguió preguntando por el azar. La
 * frase de la que salió cada pregunta está en `settings.evidence`: si ya no
 * está en ninguna lección, la pregunta se marca a revisar.
 */
import { describe, expect, it } from 'vitest';

import { avisoDePreguntasARevisar, preguntasSinFundamento } from '@api/services/agent/preguntas-a-revisar';
import { textoDeLeccion } from '@api/services/agent/grounding';

const EJERCICIOS = [
  { id: 'ej-1', title: 'Cuestionario de precios' },
  { id: 'ej-2', title: 'Examen final' }
];

const LECCION_NUEVA =
  'Validación final: se controlan 10 productos del listado de cambios del sistema de la jornada, contra el precio de la góndola.';

const PREGUNTAS = [
  {
    id: 11,
    title: '¿Cómo se eligen los productos del control final?',
    exerciseId: 'ej-1',
    settings: { evidence: 'se eligen 10 productos al azar de la góndola' }
  },
  {
    id: 12,
    title: '¿Contra qué se compara el precio?',
    exerciseId: 'ej-1',
    settings: { evidence: 'contra el precio de la góndola' }
  },
  // Sin evidencia (escrita a mano, o de antes de 2026-09): no se puede juzgar.
  { id: 13, title: '¿Quién hace el control?', exerciseId: 'ej-2', settings: {} },
  // Demasiado corta para probar nada.
  { id: 14, title: '¿Cuántos?', exerciseId: 'ej-2', settings: { evidence: 'al azar' } }
];

describe('preguntas a revisar', () => {
  it('marca la pregunta cuya frase desapareció de las lecciones, y sólo ésa', () => {
    const marcadas = preguntasSinFundamento({
      ejercicios: EJERCICIOS,
      preguntas: PREGUNTAS,
      textosDeLecciones: [LECCION_NUEVA]
    });

    expect(marcadas).toEqual([
      {
        exerciseId: 'ej-1',
        exerciseTitle: 'Cuestionario de precios',
        questionId: '11',
        questionTitle: '¿Cómo se eligen los productos del control final?',
        evidence: 'se eligen 10 productos al azar de la góndola'
      }
    ]);
  });

  it('con la lección vieja, nada está a revisar', () => {
    expect(
      preguntasSinFundamento({
        ejercicios: EJERCICIOS,
        preguntas: PREGUNTAS,
        textosDeLecciones: [`${LECCION_NUEVA} Antes: se eligen 10 productos al azar de la góndola.`]
      })
    ).toEqual([]);
  });

  it('sin texto de lecciones (otro idioma, curso vacío) no juzga nada', () => {
    expect(preguntasSinFundamento({ ejercicios: EJERCICIOS, preguntas: PREGUNTAS, textosDeLecciones: ['', '  '] })).toEqual([]);
  });

  describe('lo que NO la deja a revisar: la frase sigue ahí, escrita distinto', () => {
    const PREGUNTA = {
      id: 21,
      title: '¿Quién firma el remito?',
      exerciseId: 'ej-2',
      settings: { evidence: 'El encargado del turno firma el remito y lo guarda en la carpeta azul.' }
    };

    it.each([
      ['partida por negritas y cursivas', '<p>El <strong>encargado del turno</strong> firma el <em>remito</em> y lo guarda en la carpeta azul.</p>'],
      ['con espacios duros y saltos', '<p>El encargado del&nbsp;turno firma el remito\n y lo guarda en la carpeta&nbsp;azul.</p>'],
      ['con otra puntuación y mayúsculas', '<li>EL ENCARGADO DEL TURNO FIRMA EL REMITO, Y LO GUARDA EN LA CARPETA AZUL</li>'],
      ['sin tildes, o con otras', '<p>El encargádo del turno firma el remito y lo guarda en la carpeta azul.</p>'],
      ['en otra lección del curso', '<p>Nada que ver.</p>']
    ])('%s', (caso, html) => {
      const textos =
        caso === 'en otra lección del curso'
          ? [textoDeLeccion(html), textoDeLeccion(`<p>${PREGUNTA.settings.evidence}</p>`)]
          : [textoDeLeccion(html)];

      expect(preguntasSinFundamento({ ejercicios: EJERCICIOS, preguntas: [PREGUNTA], textosDeLecciones: textos })).toEqual([]);
    });

    it('una frase citada con puntos suspensivos se busca por su tramo más largo', () => {
      const citada = { ...PREGUNTA, settings: { evidence: 'El encargado … firma el remito y lo guarda en la carpeta azul' } };

      expect(
        preguntasSinFundamento({
          ejercicios: EJERCICIOS,
          preguntas: [citada],
          textosDeLecciones: [textoDeLeccion('<p>El encargado del turno firma el remito y lo guarda en la carpeta azul.</p>')]
        })
      ).toEqual([]);
    });
  });

  it('una lección borrada se lleva su frase: con otras lecciones en el curso, la pregunta queda a revisar', () => {
    const marcadas = preguntasSinFundamento({
      ejercicios: EJERCICIOS,
      preguntas: [PREGUNTAS[1]],
      textosDeLecciones: [textoDeLeccion('<p>Otra lección, de otro tema.</p>')]
    });

    expect(marcadas.map((pregunta) => pregunta.questionId)).toEqual(['12']);
  });

  it('una pregunta sin ejercicio, o con evidencia que no es texto, no se juzga', () => {
    expect(
      preguntasSinFundamento({
        ejercicios: EJERCICIOS,
        preguntas: [
          { id: 31, title: '¿Huérfana?', exerciseId: null, settings: { evidence: 'una frase que no está en ningún lado' } },
          { id: 32, title: '¿Rara?', exerciseId: 'ej-1', settings: { evidence: { texto: 'no es una cadena' } } },
          { id: 33, title: '¿Sin settings?', exerciseId: 'ej-1', settings: null }
        ] as never,
        textosDeLecciones: [LECCION_NUEVA]
      })
    ).toEqual([]);
  });

  it('el aviso para el modelo dice qué hacer y lista cada pregunta con su frase', () => {
    const aviso = avisoDePreguntasARevisar(
      preguntasSinFundamento({ ejercicios: EJERCICIOS, preguntas: PREGUNTAS, textosDeLecciones: [LECCION_NUEVA] })
    )!;

    expect(aviso).toContain('## Questions to review');
    expect(aviso).toContain('Change a question only if the teacher asks');
    expect(aviso).toContain(
      '- «Cuestionario de precios»: «¿Cómo se eligen los productos del control final?» — it was based on «se eligen 10 productos al azar de la góndola»'
    );
    expect(avisoDePreguntasARevisar([])).toBeUndefined();
  });
});
