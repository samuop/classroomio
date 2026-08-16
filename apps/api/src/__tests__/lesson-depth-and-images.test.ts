/**
 * Lesson depth, and the one raster image a lesson is allowed to carry.
 *
 * Both come from the same production observation: on gemini-3.5-flash-lite a real
 * 32-lesson course averaged 311 words against a stated 1,500–3,000 target, and
 * the only visuals it could produce were SVG diagrams.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  countLessonWords,
  THIN_LESSON_WORD_COUNT,
  validateLessonDepth,
  validateLessonVisuals
} from '@api/services/agent/lesson-content';

function lessonOf(words: number): string {
  return `<p>${Array.from({ length: words }, (_, i) => `palabra${i}`).join(' ')}</p>`;
}

describe('countLessonWords', () => {
  it('counts prose, not markup', () => {
    expect(countLessonWords('<p><strong>uno</strong> dos <em>tres</em></p>')).toBe(3);
  });

  it('does not let a diagram inflate the count', () => {
    const svg = '<svg viewBox="0 0 100 100"><text x="1" y="2">a</text><path d="M0 0 L1 1 L2 2 L3 3"/></svg>';

    expect(countLessonWords(`<p>uno dos</p>${svg}`)).toBe(2);
  });

  it('does not count attributes', () => {
    expect(countLessonWords('<a href="https://example.com/a/very/long/path" title="uno dos tres">link</a>')).toBe(1);
  });

  it('is zero for an empty body', () => {
    expect(countLessonWords('')).toBe(0);
    expect(countLessonWords('<p></p>')).toBe(0);
  });
});

describe('validateLessonDepth', () => {
  it('flags a lesson of the length the model actually produced', () => {
    // 311 words was the measured average across the real course.
    const warnings = validateLessonDepth(lessonOf(311));

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('311 words');
    expect(warnings[0]).toContain('edit_lesson_content');
  });

  it('says nothing once the lesson clears the floor', () => {
    expect(validateLessonDepth(lessonOf(THIN_LESSON_WORD_COUNT))).toEqual([]);
    expect(validateLessonDepth(lessonOf(2000))).toEqual([]);
  });

  it('tells the model to teach rather than to pad', () => {
    expect(validateLessonDepth(lessonOf(100))[0]).toContain('Do not pad');
  });

  it('judges a diagram-heavy lesson on its prose', () => {
    const bigSvg = `<svg viewBox="0 0 900 700">${'<rect x="1" y="2" width="3" height="4"/>'.repeat(400)}</svg>`;

    expect(validateLessonDepth(`${bigSvg}${lessonOf(120)}`)).toHaveLength(1);
  });
});

/**
 * A course on selling came back with no pictures and no diagrams at all. The
 * prompt asked for both and nothing measured the result — so, as with depth,
 * the measurement is what makes the preference bite.
 */
describe('validateLessonVisuals', () => {
  it('flags a full lesson written entirely in prose', () => {
    const warnings = validateLessonVisuals(lessonOf(900));

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('edit_lesson_content');
  });

  it('offers the free option first, so the floor is not a bill', () => {
    const warning = validateLessonVisuals(lessonOf(900))[0];

    expect(warning.indexOf('<svg')).toBeLessThan(warning.indexOf('generate_image'));
    expect(warning).toContain('free');
  });

  it('is satisfied by a diagram', () => {
    const svg = '<svg viewBox="0 0 100 100"><rect x="1" y="2" width="3" height="4"/></svg>';

    expect(validateLessonVisuals(`${lessonOf(900)}${svg}`)).toEqual([]);
  });

  it('is satisfied by a generated picture', () => {
    expect(validateLessonVisuals(`${lessonOf(900)}<img src="https://media/x.jpg" alt="a" />`)).toEqual([]);
  });

  it('leaves a genuinely short lesson alone', () => {
    // A three-paragraph definition does not need a figure, and warning about it
    // would train the model to stop reading this loop.
    expect(validateLessonVisuals(lessonOf(120))).toEqual([]);
  });

  it('does not ask for a decorative figure', () => {
    expect(validateLessonVisuals(lessonOf(900))[0]).toContain('do not add a decorative figure');
  });
});

/**
 * The generated `<img>` has to survive `sanitizeOptionalHtml`, which every
 * lesson save runs through — an element stripped there would be paid for and
 * then silently discarded.
 *
 * Spawned rather than imported for the reason documented at length in
 * `svg-sanitize.test.ts`: DOMPurify reaches jsdom, whose CommonJS file
 * `require()`s an ESM one, which vitest's externalised CJS path refuses. Running
 * it under the loader the API actually boots with also makes this a stronger
 * check than an in-process import would have been.
 */
const IMAGE_URL = 'https://learn-files.tensor.com.ar/media/courses/abc/generated/lesson-x1y2.png';

const CASES = {
  plain: `<p>antes</p><img src="${IMAGE_URL}" alt="Un termómetro de mercurio" /><p>después</p>`,
  withScript: `<img src="${IMAGE_URL}" alt="x" /><script>alert(1)</script>`,
  withHandler: `<img src="${IMAGE_URL}" alt="x" onerror="alert(1)" />`,
  javascriptSrc: '<img src="javascript:alert(1)" alt="x" />'
};

let sanitized: Record<keyof typeof CASES, string | null>;

beforeAll(() => {
  const script = `
    import { sanitizeOptionalHtml } from './src/utils/sanitize-html.ts';
    const cases = JSON.parse(process.argv[1]);
    const out = {};
    for (const [name, html] of Object.entries(cases)) out[name] = sanitizeOptionalHtml(html) ?? null;
    process.stdout.write('<<<' + JSON.stringify(out) + '>>>');
  `;

  const stdout = execFileSync(
    process.execPath,
    ['--import', 'tsx', '--input-type=module', '-e', script, JSON.stringify(CASES)],
    { cwd: path.resolve(__dirname, '../..'), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
  );

  const match = /<<<([\s\S]*)>>>/.exec(stdout);
  if (!match) throw new Error(`sanitiser produced no result:\n${stdout}`);

  sanitized = JSON.parse(match[1]);
}, 60_000);

describe('a generated image survives the save path', () => {
  it('keeps the <img> the tool hands over, with its alt text', () => {
    expect(sanitized.plain).toContain(IMAGE_URL);
    expect(sanitized.plain).toContain('Un termómetro de mercurio');
    expect(sanitized.plain).toContain('después');
  });

  it('still strips a script smuggled next to it', () => {
    expect(sanitized.withScript).toContain('<img');
    expect(sanitized.withScript).not.toContain('<script');
  });

  it('strips an event handler on the image itself', () => {
    expect(sanitized.withHandler).not.toContain('onerror');
    expect(sanitized.withHandler).toContain('<img');
  });

  it('drops a javascript: source', () => {
    expect(sanitized.javascriptSrc).not.toContain('javascript:');
  });
});
