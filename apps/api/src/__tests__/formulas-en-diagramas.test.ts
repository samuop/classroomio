import { describe, expect, it } from 'vitest';
import { validateLessonMath } from '@api/services/agent/lesson-content';

/**
 * Dos precios en un diagrama no son una fórmula.
 *
 * ── Lo que se midió (producción, 2026-09-29) ─────────────────────────────────
 *
 * Un diagrama de una planilla de precios («$ 950,00 | 120 … $ 25,00») salía
 * con el aviso «the formula(s) above will not render as maths», y el
 * constructor gastó un paso buscando una fórmula que no existía. La rama de
 * texto filtraba los pares de `$` con `looksLikeMath`; la del diagrama no, y
 * encima miraba el markup entero: entre un `$` y el siguiente quedaban el
 * cierre de un `<text>` y los atributos del próximo, con sus `=` y sus `/`.
 */

const svg = (...etiquetas: string[]) =>
  `<svg viewBox="0 0 300 100" width="300" height="100">${etiquetas
    .map((texto, i) => `<text x="10" y="${20 + i * 20}" font-size="14">${texto}</text>`)
    .join('')}</svg>`;

describe('validateLessonMath en un diagrama', () => {
  it('dos precios en etiquetas distintas no avisan nada', () => {
    expect(validateLessonMath(svg('Alfajor | $ 950,00 | 120', 'Chicle | $ 25,00 | 300'))).toEqual([]);
  });

  it('dos precios en la misma etiqueta tampoco', () => {
    expect(validateLessonMath(svg('Del $ 950,00 al $ 25,00 por unidad'))).toEqual([]);
  });

  it('una fórmula de verdad adentro de una etiqueta sigue avisando', () => {
    expect(validateLessonMath(svg('Área = $x^2$'))).toEqual([expect.stringContaining('SVG')]);
    expect(validateLessonMath(svg('Desvío \\sigma de la muestra'))).toEqual([expect.stringContaining('SVG')]);
  });

  it('los símbolos Unicode, que es lo que se pide, no avisan', () => {
    expect(validateLessonMath(svg('χ² ≤ σ₀²'))).toEqual([]);
  });
});
