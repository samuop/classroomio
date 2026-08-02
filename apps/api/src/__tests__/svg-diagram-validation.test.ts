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

  it('flags labels stacked on top of each other in the same column', () => {
    const svg = `<svg viewBox="0 0 400 200" width="400" height="200">
      <text x="20" y="40" font-size="16">Primera fila</text>
      <text x="24" y="45" font-size="16">Segunda fila</text>
    </svg>`;

    const warnings = validateSvgDiagram(svg);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('overlap');
  });

  it('does not flag labels that share a y but sit in different columns', () => {
    const svg = `<svg viewBox="0 0 600 200" width="600" height="200">
      <text x="20" y="40" font-size="16">Izquierda</text>
      <text x="400" y="40" font-size="16">Derecha</text>
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
