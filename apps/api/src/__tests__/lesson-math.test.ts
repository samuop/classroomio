/**
 * Formula handling in generated lesson content.
 *
 * Every case here comes from a real lesson the agent produced for the
 * "Probabilidad y Estadística" course, where `$\sigma_0^2$` reached the learner
 * with its dollar signs, a formula sat in a <code> block, and a diagram carried
 * `\chi^2_{1-\alpha/2}` inside SVG <text> — where KaTeX can never reach it.
 */
import { describe, expect, it } from 'vitest';

import {
  convertMarkdownMathToKatex as convert,
  normalizeAgentLessonContent,
  validateLessonMath
} from '@api/services/agent/lesson-content';

describe('convertMarkdownMathToKatex — what the renderer needs', () => {
  it('turns an inline $…$ into the node KaTeX looks for', () => {
    expect(convert('<p>donde $N$ es el tamaño poblacional</p>')).toBe(
      '<p>donde <span data-type="inline-math" data-latex="N"></span> es el tamaño poblacional</p>'
    );
  });

  it('keeps LaTeX commands intact through the attribute', () => {
    expect(convert('<p>$\\sigma_0^2$ es el valor</p>')).toContain('data-latex="\\sigma_0^2"');
  });

  it('marks $$…$$ and \\[…\\] as block maths, not two inline spans', () => {
    expect(convert('<p>$$\\chi^2 = \\frac{(n-1)S^2}{\\sigma_0^2}$$</p>')).toContain('data-type="block-math"');
    expect(convert('<p>\\[x = y\\]</p>')).toContain('data-type="block-math"');
  });

  /**
   * The tag is what the EDITOR parses on (@tiptap/extension-mathematics:
   * span[data-type="inline-math"], div[data-type="block-math"]). The viewer
   * selects on the attribute alone, so a wrong tag renders fine and is then
   * dropped the first time a teacher opens the lesson and saves.
   */
  it('emits a span for inline maths and a div for block maths', () => {
    expect(convert('<p>$N$</p>')).toContain('<span data-type="inline-math"');
    expect(convert('<p>\\[x = y\\]</p>')).toContain('<div data-type="block-math"');
    expect(convert('<p>\\[x = y\\]</p>')).not.toContain('<span data-type="block-math"');
  });

  it('lifts a display formula out of the paragraph it owns, since a div cannot live in a p', () => {
    expect(convert('<p>$$x = y$$</p>')).toBe('<div data-type="block-math" data-latex="x = y"></div>');
  });

  it('repairs block maths already stored as a span', () => {
    expect(convert('<p><span data-type="block-math" data-latex="x = y"></span></p>')).toBe(
      '<div data-type="block-math" data-latex="x = y"></div>'
    );
  });

  it('leaves inline maths as the span it is meant to be', () => {
    const node = '<p><span data-type="inline-math" data-latex="N"></span></p>';
    expect(convert(node)).toBe(node);
  });

  it('handles \\(…\\) inline delimiters', () => {
    expect(convert('<p>\\(\\chi^2 < \\chi^2_{1-\\alpha}\\)</p>')).toContain('data-type="inline-math"');
  });

  it('converts several formulas in one sentence independently', () => {
    const out = convert('<p>$H_0: \\sigma^2 = \\sigma_0^2$ contra $H_1: \\sigma^2 \\neq \\sigma_0^2$.</p>');

    expect(out.match(/data-type="inline-math"/g)).toHaveLength(2);
    expect(out).toContain('contra');
  });

  it('escapes quotes so the attribute cannot be broken out of', () => {
    expect(convert('<p>$\\text{"a"}$</p>')).toContain('&quot;');
    expect(convert('<p>$a<b$</p>')).not.toMatch(/data-latex="[^"]*<[^"]*"/);
  });
});

/**
 * Formulas parked in <code>. The model reaches for it to make a formula stand
 * out on its own line, which renders in monospace with every backslash showing —
 * 25 of the 32 lessons of the real course did it.
 */
describe('convertMarkdownMathToKatex — formulas rescued from <code>', () => {
  it('rescues the display formula exactly as the course had it', () => {
    const out = convert('<p><code>Mo = L_{i-1} + \\frac{\\Delta_1}{\\Delta_1 + \\Delta_2} \\cdot A_i</code><br>Donde…</p>');

    expect(out).toContain('data-type="inline-math"');
    expect(out).toContain('data-latex="Mo = L_{i-1} + \\frac{\\Delta_1}{\\Delta_1 + \\Delta_2} \\cdot A_i"');
    expect(out).not.toContain('<code>');
    expect(out).toContain('Donde…');
  });

  it('decodes the entities the stored HTML holds', () => {
    expect(convert('<p><code>a &lt; b \\leq c</code></p>')).toContain('data-latex="a &lt; b \\leq c"');
  });

  it('leaves a code block that is really code', () => {
    const code = '<pre><code>const media = xs.reduce((a, b) => a + b) / xs.length;</code></pre>';
    expect(convert(code)).toBe(code);
  });

  it('leaves a regex alone — \\d is not a maths command', () => {
    const code = '<p><code>\\d+\\.\\d{2}</code></p>';
    expect(convert(code)).toBe(code);
  });

  it('leaves a multi-line snippet alone, however mathematical it looks', () => {
    const code = '<pre><code>x = \\alpha\ny = \\beta</code></pre>';
    expect(convert(code)).toBe(code);
  });

  it('leaves emphasised prose alone — no LaTeX, no formula', () => {
    const code = '<p><code>Moda &lt; Mediana &lt; Media</code></p>';
    expect(convert(code)).toBe(code);
  });

  it('leaves a code block holding markup alone', () => {
    const code = '<pre><code><span>\\frac{a}{b}</span></code></pre>';
    expect(convert(code)).toBe(code);
  });

  it('is idempotent over a rescued formula', () => {
    const once = convert('<p><code>\\frac{a}{b}</code></p>');
    expect(convert(once)).toBe(once);
  });
});

describe('convertMarkdownMathToKatex — what it must NOT touch', () => {
  it('leaves prices alone', () => {
    const prose = '<p>El curso cuesta $50 y el otro $60.</p>';
    expect(convert(prose)).toBe(prose);
  });

  it('leaves a bare number between dollars alone', () => {
    const prose = '<p>de $1.500$ pesos</p>';
    expect(convert(prose)).toBe(prose);
  });

  it('never reads a $ inside code as a delimiter', () => {
    const code = '<pre><code>const total = $a + $b;</code></pre>';
    expect(convert(code)).toBe(code);
  });

  it('handles the real paragraph the defect was reported on', () => {
    const out = convert(
      '<blockquote><p><code>Mo = L_{i-1} + \\frac{\\Delta_1}{\\Delta_1 + \\Delta_2} \\cdot A_i</code><br>' +
        'Donde $\\Delta_1 = f_i - f_{i-1}$ es la diferencia con la anterior.</p></blockquote>'
    );

    expect(out.match(/data-type="inline-math"/g)).toHaveLength(2);
    expect(out).not.toContain('$');
    expect(out).not.toContain('<code>');
  });

  it('never rewrites inside an <svg>', () => {
    const svg = '<svg viewBox="0 0 10 10"><text x="1" y="2">$\\alpha$</text></svg>';
    expect(convert(svg)).toBe(svg);
  });

  it('never corrupts an attribute value', () => {
    const html = '<a href="/p?a=$x$&b=1" title="cuesta $9$">link</a>';
    expect(convert(html)).toBe(html);
  });

  it('is idempotent — an already-converted node is left as is', () => {
    const once = convert('<p>$N$</p>');
    expect(convert(once)).toBe(once);
  });
});

describe('normalizeAgentLessonContent wires the conversion in', () => {
  it('converts as part of the normal save path', () => {
    expect(normalizeAgentLessonContent('<p>valor de $\\mu$</p>', 'Medias')).toContain('data-type="inline-math"');
  });
});

describe('validateLessonMath — the warnings handed back to the model', () => {
  it('says nothing about clean content', () => {
    expect(validateLessonMath('<p><span data-type="inline-math" data-latex="N"></span> casos</p>')).toEqual([]);
  });

  it('flags a formula parked in a code block', () => {
    const warnings = validateLessonMath('<pre><code>\\chi^2 = \\frac{(n-1)S^2}{\\sigma_0^2}</code></pre>');

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('code block');
  });

  it('flags LaTeX inside a diagram, which KaTeX can never render', () => {
    const warnings = validateLessonMath(
      '<svg viewBox="0 0 10 10"><text x="1" y="2">\\chi^2_{1-\\alpha/2}</text></svg>'
    );

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('SVG');
    expect(warnings[0]).toContain('Unicode');
  });

  it('does not flag a diagram whose labels are plain Unicode', () => {
    expect(validateLessonMath('<svg viewBox="0 0 10 10"><text x="1" y="2">χ² ≤ σ₀²</text></svg>')).toEqual([]);
  });

  it('does not flag ordinary code', () => {
    expect(validateLessonMath('<pre><code>const x = arr.map((n) => n * 2);</code></pre>')).toEqual([]);
  });

  it('flags a formula too long for the converter to rewrite safely', () => {
    // Real maths, but past the 120-char cap the converter uses to stay clear of
    // prose. It declines; the warning tells the model to write the node itself.
    const long = `<p>$\\frac{${'a + b + '.repeat(20)}c}{d}$</p>`;

    expect(validateLessonMath(long)[0]).toContain('markdown-style math');
  });

  it('still says nothing about a paragraph full of prices', () => {
    expect(validateLessonMath('<p>Cuesta $50, $120 o $1.999 según el plan.</p>')).toEqual([]);
  });
});
