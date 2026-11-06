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
