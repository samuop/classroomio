import { SVG_DIAGRAM_RULES } from '@cio/ai-assistant';

import { validateSvgDiagram } from '../services/agent/lesson-content';

/**
 * Los diagramas de ejemplo del prompt tienen que cumplir las reglas del prompt.
 *
 * El modelo copia la FORMA de los ejemplos más fielmente que cualquier regla
 * escrita: medido en un curso de 21 lecciones, cuando el único ejemplo era una
 * fila de tres cajas, 20 lecciones salieron con un solo diagrama y casi todos
 * eran filas de cajas. Por eso un ejemplo que tape una etiqueta, se salga del
 * lienzo o use letra chica no es un detalle: enseña exactamente eso, en cada
 * lección, y el validador después lo marca como defecto.
 *
 * El validador de acá es el mismo que corre sobre cada lección guardada.
 */

function diagramasDelPrompt(): string[] {
  return [...SVG_DIAGRAM_RULES.matchAll(/<svg\b[\s\S]*?<\/svg>/g)].map((m) => m[0]);
}

describe('los diagramas de ejemplo de las reglas', () => {
  it('hay un ejemplo de secuencia y uno de árbol de decisión', () => {
    // Si alguien borra el árbol, vuelve a quedar un solo modelo para copiar.
    expect(diagramasDelPrompt()).toHaveLength(2);
  });

  it.each(diagramasDelPrompt().map((svg, i) => [i + 1, svg]))(
    'el ejemplo %i pasa el mismo validador que las lecciones, sin un solo aviso',
    (_n, svg) => {
      expect(validateSvgDiagram(svg as string)).toEqual([]);
    }
  );

  it('dos ejemplos no comparten el id del marcador de flecha', () => {
    // Las reglas piden un id por diagrama cuando una lección tiene varios; los
    // ejemplos tienen que predicar con eso.
    const ids = diagramasDelPrompt().flatMap((svg) => [...svg.matchAll(/<marker\b[^>]*\bid="([^"]+)"/g)].map((m) => m[1]));

    expect(new Set(ids).size).toBe(ids.length);
  });
});
