/**
 * Render every certificate template in a real browser and report where the
 * layout breaks.
 *
 * WHY THIS EXISTS. The templates are 1100x780 of fixed paper holding text of
 * unknown length, and the failure they produce is invisible to every other kind
 * of test: a flex child shrinks below its content, and a shrunk text box does
 * not reflow — it CUTS, through the middle of a line, leaving a row of
 * half-letters with the next element sitting on the remains. Unit tests see
 * well-formed HTML. Reading the CSS suggests it is fine. Only a browser knows.
 *
 * Every template shipped with at least one of these, in its plain state, before
 * any of it had a logo in it.
 *
 * WHAT IT REPORTS, and nothing else, because a naive probe drowns in false
 * positives — boxes nest, rules cross text, seals sit on borders on purpose:
 *
 *   CUT MID-LINE   a box shows a fractional number of lines: text sliced open.
 *   OFF-PAGE       ink past the page edge, or pushed off and clipped away.
 *   TEXT ON TEXT   two unrelated elements' ink genuinely overlapping.
 *   (clamped ok)   -webkit-line-clamp dropped whole lines. Legible, but the
 *                  teacher's words are not all on the certificate.
 *
 * NOT WIRED INTO `pnpm test`, deliberately: it needs a browser, and playwright
 * is not a dependency of this repo. Run it by hand after touching a template.
 *
 *   node packages/certificates/scripts/measure-layouts.mjs [--only=classique]
 *
 * Build the package first — it reads `dist/`, and a stale dist measures the
 * code you had before the change you are checking.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');

/**
 * Playwright is not a declared dependency — this script is the only thing in
 * the repo that wants a browser, and making every install pay for one to run a
 * check nobody runs in CI is the wrong trade. It IS usually present in the pnpm
 * store as somebody's transitive dependency, so look there before asking.
 */
async function loadChromium() {
  try {
    return (await import('playwright')).chromium;
  } catch {
    /* not hoisted; fall through */
  }

  const store = path.join(repoRoot, 'node_modules/.pnpm');
  const dir = fs.existsSync(store) ? fs.readdirSync(store).find((d) => d.startsWith('playwright@')) : undefined;

  if (dir) {
    const entry = path.join(store, dir, 'node_modules/playwright/index.mjs');
    if (fs.existsSync(entry)) return (await import(pathToFileURL(entry).href)).chromium;
  }

  console.error('playwright is not available here. Install it (`pnpm add -Dw playwright`) and rerun.');
  process.exit(2);
}

const chromium = await loadChromium();

const { renderCertificateDocument, DEFAULT_CERTIFICATE_DESIGN, CERTIFICATE_TEMPLATE_IDS } = await import(
  pathToFileURL(path.resolve(here, '../dist/index.js')).href
);

const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7);

/** A neutral grey block: this measures layout, not anyone's brand. */
const LOGO =
  'data:image/svg+xml;base64,' +
  Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 40"><rect width="120" height="40" rx="6" fill="#888"/></svg>'
  ).toString('base64');

const data = {
  recipientName: 'Samuel Paredes',
  courseName: 'Probability and Statistics Fundamentals',
  courseDescription:
    'Learn core concepts of probability theory and statistical analysis, including distributions, hypothesis testing, confidence intervals, and data interpretation for real-world decision making.',
  orgName: 'Consultora Ejemplo',
  orgLogoUrl: undefined,
  date: '3 de agosto de 2026',
  certificateId: 'N° 0247'
};

const CLIENT = { name: 'Kisoco One', logoUrl: LOGO };

/**
 * `plain` is the before-picture: with no logo and no client, the brand row is
 * the organisation's name as text in the same container it always used. A
 * scenario worse than plain is a regression from the brands; a failure in plain
 * was there already.
 */
const SCENARIOS = {
  'plain (no brands)': { design: {}, data: {} },
  'org logo only': { design: {}, data: { orgLogoUrl: LOGO } },
  'both brands + captions': {
    design: { clientBrand: CLIENT, labels: { deliveredBy: 'Dictado por', deliveredFor: 'Para' } },
    data: { orgLogoUrl: LOGO }
  },
  'both brands, 96px logos': { design: { clientBrand: CLIENT, brandLogoHeight: 96 }, data: { orgLogoUrl: LOGO } },
  'both brands, names printed too': {
    design: { clientBrand: CLIENT, brandShowNames: true, orgBrand: { name: 'Consultora Ejemplo' } },
    data: { orgLogoUrl: LOGO }
  },
  'short title, no brands': { design: {}, data: { courseName: 'Inducción SSMA' } },
  // Las dos ubicaciones, con el peor contenido: es lo unico que puede probar
  // que el hueco nuevo de cada plantilla tiene espacio de verdad. Sin esto la
  // medicion seguiria mirando solo el lugar donde las marcas ya estaban.
  'marcas arriba (forzado)': {
    design: { clientBrand: CLIENT, brandPlacement: 'top' },
    data: { orgLogoUrl: LOGO }
  },
  'marcas abajo (forzado)': {
    design: { clientBrand: CLIENT, brandPlacement: 'bottom' },
    data: { orgLogoUrl: LOGO }
  },
  'marcas abajo, 96px + nombres': {
    design: { clientBrand: CLIENT, brandPlacement: 'bottom', brandLogoHeight: 96, brandShowNames: true },
    data: { orgLogoUrl: LOGO }
  },
  'marcas arriba, 96px + nombres': {
    design: { clientBrand: CLIENT, brandPlacement: 'top', brandLogoHeight: 96, brandShowNames: true },
    data: { orgLogoUrl: LOGO }
  },
  // Control: la MISMA combinacion sin elegir ubicacion. Si tambien rompe, el
  // problema es previo y lo destapo, no lo introduje.
  'control: 96px + nombres, sin elegir ubicacion': {
    design: { clientBrand: CLIENT, brandLogoHeight: 96, brandShowNames: true },
    data: { orgLogoUrl: LOGO }
  },
  'worst case': {
    design: { clientBrand: CLIENT },
    data: {
      orgLogoUrl: LOGO,
      recipientName: 'María de los Ángeles Fernández Etchegaray',
      courseName: 'Fundamentos de Probabilidad, Estadística Aplicada y Análisis de Datos para la Toma de Decisiones'
    }
  }
};

const PROBE = () => {
  const nodes = [];

  document.querySelectorAll('.cert *').forEach((node) => {
    const style = getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return;

    const rect = node.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;

    const ownText = Array.from(node.childNodes)
      .filter((c) => c.nodeType === 3)
      .map((c) => c.textContent.trim())
      .join(' ')
      .trim();

    const isImage = node.tagName === 'IMG';
    if (!ownText && !isImage) return;

    const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2;

    // What actually paints, not what the box claims. An inline <em> inside a
    // clamped, overflow-hidden title reports a rect spanning every line it
    // would occupy unclipped, so comparing raw rects invents collisions with
    // whatever sits below and buries the real ones.
    let ink = { l: rect.left, t: rect.top, r: rect.right, b: rect.bottom };
    let clippedInside = false;

    for (let p = node.parentElement; p && p !== document.body; p = p.parentElement) {
      const ps = getComputedStyle(p);
      if (!/hidden|clip|auto|scroll/.test(ps.overflow + ps.overflowX + ps.overflowY)) continue;

      // The page clips because things ran off it; anything else clips because a
      // clamp was asked for, and that is reported separately as lost lines.
      if (!p.classList.contains('cert')) clippedInside = true;

      const pr = p.getBoundingClientRect();
      ink = {
        l: Math.max(ink.l, pr.left),
        t: Math.max(ink.t, pr.top),
        r: Math.min(ink.r, pr.right),
        b: Math.min(ink.b, pr.bottom)
      };
    }

    // Clipped to nothing means it was pushed off the page and does not render
    // at all. That is still a missing signature row, so it is kept and reported
    // rather than quietly dropped.
    const erased = ink.r - ink.l < 1 || ink.b - ink.t < 1;
    if (erased) ink = { l: rect.left, t: rect.top, r: rect.right, b: rect.bottom };

    nodes.push({
      node,
      cls: typeof node.className === 'string' ? node.className : '',
      text: ownText.slice(0, 32),
      isImage,
      erased,
      clippedInside,
      raw: { x: rect.left, y: rect.top, w: rect.width, h: rect.height },
      x: ink.l,
      y: ink.t,
      w: ink.r - ink.l,
      h: ink.b - ink.t,
      lineHeight,
      clientHeight: node.clientHeight,
      scrollHeight: node.scrollHeight
    });
  });

  const result = { cut: [], clamped: [], outside: [], overlap: [] };

  for (const n of nodes) {
    if (!n.isImage && n.lineHeight > 0) {
      const shows = n.clientHeight / n.lineHeight;
      const needs = n.scrollHeight / n.lineHeight;
      const partial = shows - Math.floor(shows);

      // A cut needs BOTH: the box shows less than its text needs, AND what it
      // shows is not a whole number of lines. Whole lines mean the clamp
      // stopped at a boundary, which is legible and deliberate. `needs` runs
      // slightly over a round number on tight line-heights because ascenders
      // overflow the line box, which is why the fraction alone cannot decide.
      if (needs - shows > 0.05 && partial > 0.12 && partial < 0.88) {
        result.cut.push({ cls: n.cls, text: n.text, shows: +shows.toFixed(2), needs: +needs.toFixed(2) });
      } else if (needs - shows >= 1) {
        result.clamped.push({ cls: n.cls, text: n.text, lost: Math.floor(needs - shows) });
      }
    }

    if (n.clippedInside) continue;

    // Measured on the UNCLIPPED box: text shoved past the bottom edge is missing
    // from the certificate whether the browser paints it out there or clips it
    // away, and clipping is the usual outcome.
    const r = n.raw;
    if (n.erased || r.y < -0.5 || r.x < -0.5 || r.y + r.h > 780.5 || r.x + r.w > 1100.5) {
      result.outside.push({
        cls: n.cls,
        text: n.text,
        y: Math.round(r.y),
        h: Math.round(r.h),
        why: n.erased ? 'clipped away entirely' : 'past the page edge'
      });
    }
  }

  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i];
      const b = nodes[j];

      if (a.erased || b.erased) continue;
      // Nested boxes always "overlap"; that is containment, not collision.
      if (a.node.contains(b.node) || b.node.contains(a.node)) continue;

      const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (w <= 1 || h <= 1) continue;

      // Ink has to genuinely sit on ink: a third of the smaller box. Glyph
      // boxes graze each other constantly at tight line-heights.
      const area = w * h;
      if (area < 0.33 * Math.min(a.w * a.h, b.w * b.h)) continue;

      result.overlap.push({ a: a.text || '.' + a.cls, b: b.text || '.' + b.cls, area: Math.round(area) });
    }
  }

  return result;
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 780 } });

let total = 0;

for (const templateId of CERTIFICATE_TEMPLATE_IDS) {
  if (only && templateId !== only) continue;

  console.log('\n=== ' + templateId.toUpperCase() + ' ===');

  for (const [label, s] of Object.entries(SCENARIOS)) {
    const html = renderCertificateDocument(
      { ...DEFAULT_CERTIFICATE_DESIGN, templateId, ...s.design },
      { ...data, ...s.data }
    );

    await page.setContent(html, { waitUntil: 'load' });
    // Measuring against a fallback face puts every box in the wrong place.
    await page.evaluate(() => document.fonts.ready);

    const r = await page.evaluate(PROBE);
    const bad = r.cut.length + r.outside.length + r.overlap.length;
    total += bad;

    console.log(`  ${bad === 0 ? 'OK  ' : 'BAD '} ${label}`);

    for (const c of r.cut) {
      console.log(`        CUT MID-LINE: .${c.cls} "${c.text}" shows ${c.shows} of ${c.needs} lines`);
    }
    for (const o of r.outside) console.log(`        OFF-PAGE (${o.why}): .${o.cls} "${o.text}" y=${o.y} h=${o.h}`);
    for (const o of r.overlap) console.log(`        TEXT ON TEXT (${o.area}px2): "${o.a}" x "${o.b}"`);
    for (const c of r.clamped) console.log(`        (clamped ok, ${c.lost} line(s) not shown): .${c.cls} "${c.text}"`);
  }
}

await browser.close();
console.log('\nTOTAL PROBLEMS: ' + total);
process.exit(total ? 1 : 0);
