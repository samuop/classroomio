/**
 * The overflow contract — what keeps a free-positioned certificate safe.
 *
 * A canvas fixes coordinates; the data does not have a fixed size. "Ana Ruiz"
 * and "María de los Ángeles Fernández Etchegaray" go in the same box, and a
 * layout that only knows where things sit will eventually stack one over
 * another. That already happened once, when a long description slid under the
 * seal in `classique`.
 *
 * These tests pin the two properties the engine has to have: it is DETERMINISTIC
 * (the browser preview and the Node export must agree, or WYSIWYG is a lie) and
 * it errs toward shrinking rather than spilling.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MIN_FONT_SIZE,
  estimateTextWidth,
  fitText,
  wrapText,
  type TextStyle
} from '@cio/certificates';

const style: TextStyle = {
  fontFamily: 'Space Grotesk',
  fontSize: 40,
  fontWeight: 400,
  lineHeight: 1.2,
  letterSpacing: 0,
  color: '#000000',
  align: 'center',
  verticalAlign: 'middle'
};

const box = (w: number, h: number) => ({ w, h });

describe('estimateTextWidth', () => {
  it('scales with the font size', () => {
    const small = estimateTextWidth('Ana Ruiz', 20, style);
    const large = estimateTextWidth('Ana Ruiz', 40, style);

    expect(large).toBeCloseTo(small * 2, 5);
  });

  it('charges letter-spacing for the gaps between glyphs, not for every glyph', () => {
    const tight = estimateTextWidth('abcde', 40, { ...style, letterSpacing: 0 });
    const loose = estimateTextWidth('abcde', 40, { ...style, letterSpacing: 2 });

    expect(loose - tight).toBe(8); // 5 glyphs, 4 gaps
  });

  it('treats an unknown family as wide, so it shrinks rather than spills', () => {
    const known = estimateTextWidth('texto', 40, { ...style, fontFamily: 'Cormorant Garamond' });
    const unknown = estimateTextWidth('texto', 40, { ...style, fontFamily: 'Something Unheard Of' });

    expect(unknown).toBeGreaterThan(known);
  });

  it('is a pure function of its inputs — the same call twice gives the same number', () => {
    // The whole WYSIWYG guarantee rests on this: no DOM, no font loading, no
    // ambient state that could differ between the browser and Node.
    const once = estimateTextWidth('Fundamentos de Probabilidad', 33, style);
    const twice = estimateTextWidth('Fundamentos de Probabilidad', 33, style);

    expect(once).toBe(twice);
  });
});

describe('wrapText', () => {
  it('keeps a short line whole', () => {
    expect(wrapText('Ana Ruiz', 600, 40, style)).toEqual(['Ana Ruiz']);
  });

  it('breaks a long line into several', () => {
    const lines = wrapText('María de los Ángeles Fernández Etchegaray', 300, 40, style);

    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join(' ')).toBe('María de los Ángeles Fernández Etchegaray');
  });

  it('hard-breaks a single word wider than the box instead of letting it stick out', () => {
    const lines = wrapText('Antidisestablishmentarianism', 80, 40, style);

    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join('')).toBe('Antidisestablishmentarianism');
  });

  it('honours explicit newlines', () => {
    expect(wrapText('uno\ndos', 600, 20, style)).toEqual(['uno', 'dos']);
  });

  it('never returns an empty array, so callers can always count lines', () => {
    expect(wrapText('', 600, 40, style)).toEqual(['']);
  });
});

describe('fitText — shrink', () => {
  it('leaves text that already fits at its designed size', () => {
    const result = fitText({ ...box(700, 60), style, fit: 'shrink' }, 'Ana Ruiz');

    expect(result.fontSize).toBe(40);
    expect(result.overflows).toBe(false);
  });

  it('shrinks a long name until it fits its box', () => {
    const result = fitText({ ...box(420, 56), style, fit: 'shrink' }, 'María de los Ángeles Fernández Etchegaray');

    expect(result.fontSize).toBeLessThan(40);
    expect(result.overflows).toBe(false);
  });

  it('stops at the floor rather than shrinking into illegibility', () => {
    const result = fitText(
      { ...box(60, 20), style, fit: 'shrink', minFontSize: 14 },
      'María de los Ángeles Fernández Etchegaray'
    );

    expect(result.fontSize).toBe(14);
    // Reported, not hidden: the editor warns so the teacher fixes the design
    // before a single certificate goes out with crowded text.
    expect(result.overflows).toBe(true);
  });

  it('uses the default floor when the element does not set one', () => {
    const result = fitText({ ...box(30, 16), style, fit: 'shrink' }, 'un texto bastante largo para esta caja');

    expect(result.fontSize).toBe(DEFAULT_MIN_FONT_SIZE);
  });

  it('accounts for uppercase being wider than the mixed-case average', () => {
    const mixed = fitText({ ...box(360, 56), style, fit: 'shrink' }, 'Certificado de Aprobación');
    const caps = fitText({ ...box(360, 56), style: { ...style, uppercase: true }, fit: 'shrink' }, 'Certificado de Aprobación');

    expect(caps.fontSize).toBeLessThanOrEqual(mixed.fontSize);
  });
});

describe('fitText — clamp', () => {
  it('keeps the designed size and caps the line count', () => {
    const result = fitText(
      { ...box(400, 200), style: { ...style, fontSize: 16 }, fit: 'clamp', maxLines: 3 },
      'Programa integral de formación que abarca inferencia estadística, diseño de experimentos y control de procesos aplicado a la industria.'
    );

    expect(result.fontSize).toBe(16);
    expect(result.maxLines).toBe(3);
    expect(result.lines).toBeLessThanOrEqual(3);
  });

  it('never allows more lines than the box physically holds', () => {
    // A maxLines of 8 in a two-line box would clamp at a height nobody sees,
    // and the extra lines would render straight over the element below.
    const result = fitText(
      { ...box(400, 40), style: { ...style, fontSize: 16 }, fit: 'clamp', maxLines: 8 },
      'Programa integral de formación que abarca inferencia estadística y diseño de experimentos.'
    );

    expect(result.maxLines).toBeLessThanOrEqual(2);
  });

  it('reports overflow when the content is cut', () => {
    const result = fitText(
      { ...box(200, 200), style: { ...style, fontSize: 16 }, fit: 'clamp', maxLines: 1 },
      'Programa integral de formación aplicada a la industria metalúrgica.'
    );

    expect(result.overflows).toBe(true);
  });
});

describe('fitText — headroom', () => {
  it('leaves margin instead of filling the box to the last pixel', () => {
    // The bug this exists for: the classique title fit at 51px with an estimated
    // line of 915px inside a 920px box. Widths here are estimates, so a fit that
    // exact overflows the moment the estimate is off by a percent — and it was,
    // visibly, over the neighbouring elements.
    const box = { w: 920, h: 104 };
    const titleStyle: TextStyle = { ...style, fontFamily: 'Bodoni Moda', fontSize: 66, lineHeight: 1.06, italic: true };

    const result = fitText({ ...box, style: titleStyle, fit: 'shrink', minFontSize: 32 }, 'Probability and Statistics Fundamentals');
    const width = estimateTextWidth('Probability and Statistics Fundamentals', result.fontSize, titleStyle);

    expect(width).toBeLessThan(box.w * 0.96);
  });

  it('applies the same headroom vertically', () => {
    // A line count derived from an over-optimistic width is wrong about the
    // height too, so margin on one axis only would not help.
    const result = fitText(
      { ...box(400, 100), style: { ...style, fontSize: 20, lineHeight: 1.0 }, fit: 'shrink', minFontSize: 20 },
      'una linea\notra linea\nuna tercera\nuna cuarta\nuna quinta'
    );

    expect(result.overflows).toBe(true);
  });
});

describe('fitText — overflow', () => {
  it('leaves the size untouched and still reports the spill', () => {
    const result = fitText({ ...box(120, 30), style, fit: 'overflow' }, 'un texto que claramente no entra acá');

    expect(result.fontSize).toBe(40);
    expect(result.overflows).toBe(true);
  });
});
