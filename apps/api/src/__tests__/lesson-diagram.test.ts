import { describe, expect, it } from 'vitest';
import { listLessonDiagrams, replaceDiagramAt } from '../services/agent/diagram';

/**
 * The redraw control identifies a diagram by its position among the lesson's
 * SVGs. Two things must hold for that to be safe: the server must enumerate the
 * same diagrams the client does, and the splice must leave every other byte of
 * the lesson untouched. A slip in either replaces the wrong picture, or quietly
 * corrupts the surrounding HTML.
 */

const SVG_A = '<svg viewBox="0 0 100 50" width="100" height="50"><rect x="0" y="0" width="10" height="10"/></svg>';
const SVG_B = '<svg viewBox="0 0 200 80" width="200" height="80"><circle cx="20" cy="20" r="5"/></svg>';

const LESSON = `<h3>Intro</h3><p>Antes del primero.</p>${SVG_A}<p>Entre los dos.</p>${SVG_B}<p>Después del segundo.</p>`;

describe('listLessonDiagrams', () => {
  it('finds every diagram in document order', () => {
    const found = listLessonDiagrams(LESSON);

    expect(found).toHaveLength(2);
    expect(found[0].svg).toBe(SVG_A);
    expect(found[1].svg).toBe(SVG_B);
    expect(found[0].index).toBe(0);
    expect(found[1].index).toBe(1);
  });

  it('returns nothing for content without diagrams', () => {
    expect(listLessonDiagrams('<p>Sólo texto.</p>')).toEqual([]);
    expect(listLessonDiagrams('')).toEqual([]);
  });

  it('is not confused by the word svg appearing in prose', () => {
    const found = listLessonDiagrams(`<p>Un archivo .svg es vectorial.</p>${SVG_A}`);

    expect(found).toHaveLength(1);
    expect(found[0].svg).toBe(SVG_A);
  });

  it('reports offsets that slice back to the original markup', () => {
    const [first, second] = listLessonDiagrams(LESSON);

    expect(LESSON.slice(first.start, first.end)).toBe(SVG_A);
    expect(LESSON.slice(second.start, second.end)).toBe(SVG_B);
  });
});

describe('replaceDiagramAt', () => {
  const REPLACEMENT = '<svg viewBox="0 0 10 10" width="10" height="10"><path d="M0 0"/></svg>';

  it('swaps the targeted diagram and leaves the rest byte-identical', () => {
    const [, second] = listLessonDiagrams(LESSON);
    const updated = replaceDiagramAt(LESSON, second, REPLACEMENT);

    expect(updated).toContain(SVG_A);
    expect(updated).toContain(REPLACEMENT);
    expect(updated).not.toContain(SVG_B);
    expect(updated).toBe(LESSON.replace(SVG_B, REPLACEMENT));
  });

  it('keeps the diagram count stable so positions stay valid for the next edit', () => {
    const [first] = listLessonDiagrams(LESSON);
    const updated = replaceDiagramAt(LESSON, first, REPLACEMENT);
    const after = listLessonDiagrams(updated);

    expect(after).toHaveLength(2);
    expect(after[0].svg).toBe(REPLACEMENT);
    expect(after[1].svg).toBe(SVG_B);
  });

  it('handles two identical diagrams without touching the wrong one', () => {
    const twice = `<p>a</p>${SVG_A}<p>b</p>${SVG_A}<p>c</p>`;
    const [, second] = listLessonDiagrams(twice);
    const updated = replaceDiagramAt(twice, second, REPLACEMENT);

    // A find-and-replace on the markup would have hit the FIRST copy; splicing by
    // offset is the reason this case is safe at all.
    expect(updated).toBe(`<p>a</p>${SVG_A}<p>b</p>${REPLACEMENT}<p>c</p>`);
  });
});

/**
 * Parity guard. `splitHtmlAndSvg` in packages/ui drives the index the browser
 * sends; `listLessonDiagrams` resolves it here. This reimplements the UI regex
 * literally — if someone changes one side, this test fails instead of production
 * silently rewriting the wrong diagram.
 */
describe('index parity with the UI splitter', () => {
  const UI_SVG_REGEX = /<svg\b[^>]*>[\s\S]*?<\/svg>/gi;

  function uiSvgSegments(html: string): string[] {
    return html.match(UI_SVG_REGEX) ?? [];
  }

  it('enumerates the same diagrams, in the same order', () => {
    const samples = [
      LESSON,
      `${SVG_A}${SVG_B}`,
      `<p>nada</p>`,
      `<div>${SVG_B}</div><p>x</p>${SVG_A}`,
      `<p>a .svg mention</p>${SVG_A}`
    ];

    for (const sample of samples) {
      expect(listLessonDiagrams(sample).map((d) => d.svg)).toEqual(uiSvgSegments(sample));
    }
  });
});
