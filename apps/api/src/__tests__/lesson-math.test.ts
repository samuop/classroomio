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

describe('convertMarkdownMathToKatex — what it must NOT touch', () => {
  it('leaves prices alone', () => {
    const prose = '<p>El curso cuesta $50 y el otro $60.</p>';
    expect(convert(prose)).toBe(prose);
  });

  it('leaves a bare number between dollars alone', () => {
    const prose = '<p>de $1.500$ pesos</p>';
    expect(convert(prose)).toBe(prose);
  });

  it('never rewrites inside <code> or <pre>', () => {
    const code = '<pre><code>const total = $a + $b;</code></pre>';
    expect(convert(code)).toBe(code);
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
