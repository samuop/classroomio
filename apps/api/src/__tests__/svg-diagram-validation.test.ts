import { describe, expect, it } from 'vitest';
import { validateSvgDiagram } from '../services/agent/lesson-content';

/**
 * The prompt tells the agent to keep diagram text at font-size ≥ 14 and to space
 * rows at least 40px apart. Nothing checked, so unreadable diagrams shipped
 * silently. These warnings ride back in the tool result so the model fixes its own
 * work — geometry can be repaired deterministically, layout cannot.
 */
describe('validateSvgDiagram', () => {
  it('returns nothing for content with no SVG', () => {
    expect(validateSvgDiagram('<p>Just prose.</p>')).toEqual([]);
  });

  it('returns nothing for a well-formed diagram', () => {
    const svg = `<svg viewBox="0 0 400 200" width="400" height="200">
      <text x="20" y="40" font-size="16">Entrada</text>
      <text x="20" y="120" font-size="16">Salida</text>
    </svg>`;

    expect(validateSvgDiagram(svg)).toEqual([]);
  });

  it('flags text below the readable font size', () => {
    const svg = `<svg viewBox="0 0 400 200" width="400" height="200">
      <text x="20" y="40" font-size="9">Muestra</text>
    </svg>`;

    const warnings = validateSvgDiagram(svg);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('font-size below 12');
    expect(warnings[0]).toContain('9');
  });

  it('flags labels stacked on top of each other', () => {
    const svg = `<svg viewBox="0 0 400 200" width="400" height="200">
      <text x="20" y="40" font-size="16">Primera fila</text>
      <text x="24" y="45" font-size="16">Segunda fila</text>
    </svg>`;

    const warnings = validateSvgDiagram(svg);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('overlap');
  });

  it('does not flag labels that share a y but sit far apart horizontally', () => {
    const svg = `<svg viewBox="0 0 600 200" width="600" height="200">
      <text x="20" y="40" font-size="16">Izq</text>
      <text x="400" y="40" font-size="16">Der</text>
    </svg>`;

    expect(validateSvgDiagram(svg)).toEqual([]);
  });

  /**
   * Regression: a full-width caption crossing the axis tick labels. The previous
   * implementation bucketed text by 40px columns, so a sentence spanning the whole
   * figure was never compared against the short labels it ran through.
   */
  it('flags a wide caption that runs through narrow axis labels', () => {
    const svg = `<svg viewBox="0 0 640 240" width="640" height="240">
      <text x="80" y="220" font-size="14">1h</text>
      <text x="300" y="220" font-size="14">3h</text>
      <text x="520" y="220" font-size="14">5h</text>
      <text x="320" y="222" font-size="14" text-anchor="middle">Tendencia creciente: a más horas de estudio, mejor calificación.</text>
    </svg>`;

    const warnings = validateSvgDiagram(svg);

    expect(warnings.some((w) => w.includes('overlap'))).toBe(true);
  });

  /**
   * Regression: the Venn diagram whose intersection ellipse was emitted after the
   * set labels, rendering "A: pares" as "A: pare". Painting order, not proximity.
   */
  it('flags a label buried under a shape painted after it', () => {
    const svg = `<svg viewBox="0 0 640 300" width="640" height="300">
      <text x="240" y="150" font-size="15">A: pares</text>
      <ellipse cx="250" cy="150" rx="70" ry="80" fill="#6ee7b7"/>
    </svg>`;

    const warnings = validateSvgDiagram(svg);

    expect(warnings.some((w) => w.includes('painted over'))).toBe(true);
  });

  it('does not flag a label sitting inside a shape drawn before it', () => {
    const svg = `<svg viewBox="0 0 400 120" width="400" height="120">
      <rect x="20" y="30" width="200" height="50" rx="8" fill="#e2e8f0" stroke="#334155"/>
      <text x="120" y="60" font-size="15" text-anchor="middle">Experimento</text>
    </svg>`;

    expect(validateSvgDiagram(svg)).toEqual([]);
  });

  it('ignores transparent shapes, which cannot hide anything', () => {
    const svg = `<svg viewBox="0 0 400 120" width="400" height="120">
      <text x="120" y="60" font-size="15">Etiqueta</text>
      <rect x="20" y="30" width="300" height="50" fill="none" stroke="#334155"/>
    </svg>`;

    expect(validateSvgDiagram(svg)).toEqual([]);
  });

  it('names each diagram when a lesson has several', () => {
    const svg = `<svg viewBox="0 0 400 200" width="400" height="200">
        <text x="20" y="40" font-size="16">Bien</text>
      </svg>
      <p>Texto entre diagramas.</p>
      <svg viewBox="0 0 400 200" width="400" height="200">
        <text x="20" y="40" font-size="8">Ilegible</text>
      </svg>`;

    const warnings = validateSvgDiagram(svg);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('diagram 2');
  });

  it('ignores text nodes with no usable coordinates', () => {
    const svg = `<svg viewBox="0 0 400 200" width="400" height="200">
      <text font-size="16">Sin coordenadas</text>
      <text font-size="16">Tampoco</text>
    </svg>`;

    expect(validateSvgDiagram(svg)).toEqual([]);
  });
});
