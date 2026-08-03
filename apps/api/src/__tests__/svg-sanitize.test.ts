/**
 * SVG uploads, which exist because a certificate needs a logo with no
 * background and no resolution.
 *
 * An SVG is a document, not a picture: it can carry `<script>`, event handlers,
 * and `<foreignObject>` holding arbitrary HTML. Accepting one unmodified would
 * mean the platform hosting a script on the uploader's behalf, which is why this
 * repo refused SVG outright before. These tests are why it is safe to stop.
 *
 * ── Why this suite spawns a process ──────────────────────────────────────────
 *
 * `sanitizeSvg` cannot be imported into vitest at all. It uses DOMPurify, which
 * reaches jsdom, which has a CommonJS file that `require()`s an ESM one. Node
 * permits that under the API's own ESM loader; vitest's externalised CJS path
 * does not, and the suite fails to collect before a single test runs.
 * `server.deps.inline` does not reach the nested require, and esbuild
 * pre-bundling breaks on a duplicate `createRequire` inside jsdom.
 *
 * So the sanitiser is exercised through the loader the API actually boots with.
 * That makes this closer to the real thing than an in-process import would have
 * been: it proves the function works where it runs, not only where it compiles.
 * One spawn covers every case — the process start is the expensive part, not the
 * sanitising.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

const CASES = {
  logo: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40"><rect width="100" height="40" fill="#e11"/></svg>',
  script:
    '<svg xmlns="http://www.w3.org/2000/svg"><script>fetch("/steal")</script><rect width="1" height="1"/></svg>',
  handler: '<svg xmlns="http://www.w3.org/2000/svg"><rect onload="alert(1)" width="1" height="1"/></svg>',
  foreignObject:
    '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><iframe src="https://evil.test"></iframe></foreignObject></svg>',
  link: '<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript:alert(1)"><rect width="1" height="1"/></a></svg>',
  scriptOnly: '<script>alert(1)</script>',
  notSvg: 'not an svg at all'
};

let results: Record<keyof typeof CASES, string | null>;

beforeAll(() => {
  const apiRoot = path.resolve(__dirname, '../..');

  const script = `
    import { sanitizeSvg } from './src/services/media.ts';
    const cases = JSON.parse(process.argv[1]);
    const out = {};
    for (const [name, svg] of Object.entries(cases)) out[name] = sanitizeSvg(svg);
    process.stdout.write('<<<' + JSON.stringify(out) + '>>>');
  `;

  const stdout = execFileSync(
    process.execPath,
    ['--import', 'tsx', '--input-type=module', '-e', script, JSON.stringify(CASES)],
    { cwd: apiRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
  );

  // Delimited, because tsx and node both write notices to stdout on some
  // versions and a stray line would make this fail for the wrong reason.
  const match = /<<<([\s\S]*)>>>/.exec(stdout);
  if (!match) throw new Error(`sanitiser produced no result:\n${stdout}`);

  results = JSON.parse(match[1]);
}, 60_000);

describe('sanitizeSvg', () => {
  it('leaves an ordinary logo intact', () => {
    expect(results.logo).toContain('<svg');
    expect(results.logo).toContain('<rect');
    expect(results.logo).toContain('#e11');
  });

  it('strips a script element but keeps the artwork', () => {
    expect(results.script).not.toContain('script');
    expect(results.script).not.toContain('fetch');
    expect(results.script).toContain('<rect');
  });

  it('strips an inline event handler', () => {
    expect(results.handler).not.toContain('onload');
    expect(results.handler).not.toContain('alert');
  });

  it('strips foreignObject, which smuggles HTML past an SVG-shaped check', () => {
    expect(results.foreignObject).not.toContain('foreignObject');
    expect(results.foreignObject).not.toContain('iframe');
  });

  it('strips references that reach outside the file', () => {
    // A logo has no reason to load from or link anywhere; those attributes are
    // how an SVG pulls in something the sanitiser never saw.
    expect(results.link).not.toContain('javascript:');
  });

  it('returns null when nothing recognisable survives, so the upload is refused', () => {
    // Storing an empty file would leave the teacher with a logo slot that looks
    // filled and prints nothing.
    expect(results.scriptOnly).toBeNull();
    expect(results.notSvg).toBeNull();
  });
});
