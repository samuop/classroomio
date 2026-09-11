/**
 * El largo de una lección ya NO se controla, y la imagen que puede llevar sí.
 *
 * Hubo un piso de 700 palabras: menos que eso y la lección volvía al modelo como
 * "demasiado delgada, expandila". Se saco porque medía lo que no importa. El
 * largo se verificaba en el servidor; el FUNDAMENTO —que lo escrito salga de una
 * fuente real— solo se pedía en prosa. Con una fuente de 15 palabras y un piso
 * de 700, lo unico que el sistema empujaba era "escribí más", y el modelo
 * llenaba el hueco inventando.
 *
 * `countLessonWords` sobrevive porque la regla de la imagen la necesita: una
 * lección de dos párrafos no necesita ilustración, una larga sí.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

import { countLessonWords, validateLessonVisuals } from '@api/services/agent/lesson-content';
import * as contenidoDeLeccion from '@api/services/agent/lesson-content';

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

describe('el piso de palabras, que ya no existe', () => {
  it('no queda ningun verificador de largo que el modelo pueda sentir', () => {
    // El test que muerde de verdad: si alguien reintroduce `validateLessonDepth`
    // —o cualquier primo suyo— vuelve la presion que hacia inventar, y esto lo
    // caza antes de que llegue a produccion.
    const exportados = Object.keys(contenidoDeLeccion);

    expect(exportados).not.toContain('validateLessonDepth');
    expect(exportados).not.toContain('THIN_LESSON_WORD_COUNT');
    expect(exportados.filter((n) => /depth|thin|wordFloor|minWords/i.test(n))).toEqual([]);
  });

  it('una leccion corta y fundada no genera ninguna queja', () => {
    // 120 palabras con su diagrama: antes esto volvia con "demasiado delgada".
    // Es exactamente lo que deberia producir una fuente honesta pero chica.
    const svg = '<svg viewBox="0 0 400 300"><text x="10" y="20" font-size="16">Direccion</text></svg>';

    expect(validateLessonVisuals(`${svg}${lessonOf(120)}`)).toEqual([]);
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
