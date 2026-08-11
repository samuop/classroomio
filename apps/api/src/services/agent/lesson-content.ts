function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripLeadingLessonTitle(content: string, lessonTitle: string): string {
  const normalizedTitle = lessonTitle.trim();

  if (!normalizedTitle) {
    return content;
  }

  const escapedTitle = escapeRegExp(normalizedTitle);
  const patterns = [
    new RegExp(`^\\s*<h[1-6][^>]*>\\s*${escapedTitle}\\s*</h[1-6]>\\s*`, 'i'),
    new RegExp(
      `^\\s*<p[^>]*>\\s*(?:<strong[^>]*>|<b[^>]*>)?\\s*${escapedTitle}\\s*(?:</strong>|</b>)?\\s*</p>\\s*`,
      'i'
    )
  ];

  let nextContent = content;

  for (const pattern of patterns) {
    nextContent = nextContent.replace(pattern, '');
  }

  return nextContent;
}

function normalizeHeadingLevels(content: string): string {
  return content
    .replace(/<h1(\s|>)/gi, '<h3$1')
    .replace(/<\/h1>/gi, '</h3>')
    .replace(/<h2(\s|>)/gi, '<h3$1')
    .replace(/<\/h2>/gi, '</h3>');
}

/** Extract a numeric attribute value (e.g. width="640") from an opening tag. */
function readNumericAttr(openTag: string, attr: string): number | null {
  const match = openTag.match(new RegExp(`${attr}\\s*=\\s*["']?\\s*([\\d.]+)`, 'i'));
  if (!match) return null;
  const value = Number.parseFloat(match[1]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * Structural repair for agent-generated SVG diagrams. Deterministic and defensive
 * — it only fills in MISSING geometry so the diagram renders at a sane size and is
 * not silently clipped; it never rewrites the artwork. The SVG renders in a
 * sandboxed box whose height comes from the root `height` attribute, so an <svg>
 * missing width/height or viewBox is the top cause of broken/clipped diagrams.
 * Also strips <foreignObject> here (the downstream sanitizer removes it too, but
 * doing it early keeps the stored content clean).
 */
function repairSvgGeometry(content: string): string {
  // Drop <foreignObject>…</foreignObject> (banned; sanitizer strips it anyway).
  let out = content.replace(/<foreignObject\b[\s\S]*?<\/foreignObject>/gi, '');

  // Rewrite each root <svg …> opening tag, adding missing viewBox/width/height.
  out = out.replace(/<svg\b([^>]*)>/gi, (fullTag, attrs: string) => {
    const hasViewBox = /viewBox\s*=/i.test(attrs);
    const width = readNumericAttr(attrs, 'width');
    const height = readNumericAttr(attrs, 'height');

    let extra = '';

    if (!hasViewBox && width && height) {
      // Has explicit size but no viewBox → derive it so the art scales.
      extra += ` viewBox="0 0 ${width} ${height}"`;
    } else if (hasViewBox && (!width || !height)) {
      // Has viewBox but is missing an explicit dimension → derive from viewBox
      // (the sandbox box needs a real height or it clips / defaults tiny).
      const vb = attrs.match(/viewBox\s*=\s*["']\s*[\d.]+\s+[\d.]+\s+([\d.]+)\s+([\d.]+)/i);
      if (vb) {
        const vbW = Number.parseFloat(vb[1]);
        const vbH = Number.parseFloat(vb[2]);
        if (!width && Number.isFinite(vbW)) extra += ` width="${vbW}"`;
        if (!height && Number.isFinite(vbH)) extra += ` height="${vbH}"`;
      }
    } else if (!hasViewBox && !width && !height) {
      // No geometry at all → a safe default box so it renders instead of collapsing.
      extra += ' viewBox="0 0 640 360" width="640" height="360"';
    }

    return extra ? `<svg${attrs}${extra}>` : fullTag;
  });

  return out;
}

/** Below this, labels are unreadable in the rendered lesson. Mirrors the prompt rule. */
const MIN_READABLE_FONT_SIZE = 12;
/** Assumed font-size when a <text> does not declare one. */
const DEFAULT_FONT_SIZE = 16;
/** Mean glyph width as a fraction of font-size, for a proportional sans/serif face. */
const GLYPH_WIDTH_RATIO = 0.55;
/** Fraction of a label's own box that must be covered before we call it a collision. */
const OVERLAP_THRESHOLD = 0.3;

type Box = { x1: number; y1: number; x2: number; y2: number };

function readAttr(attrs: string, name: string): number | null {
  const match = attrs.match(new RegExp(`\\b${name}\\s*=\\s*["']?\\s*(-?[\\d.]+)`, 'i'));
  if (!match) return null;
  const value = Number.parseFloat(match[1]);
  return Number.isFinite(value) ? value : null;
}

function intersectionArea(a: Box, b: Box): number {
  const w = Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1);
  const h = Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1);
  return w > 0 && h > 0 ? w * h : 0;
}

function boxArea(b: Box): number {
  return Math.max(0, b.x2 - b.x1) * Math.max(0, b.y2 - b.y1);
}

/**
 * Approximate the rendered box of a <text> node.
 *
 * Width is estimated from the glyph count — there is no font metric server-side —
 * which is rough but good enough to catch a caption running across a whole
 * diagram, the case that actually breaks. `y` is the baseline, so the box sits
 * mostly above it.
 */
function textBox(attrs: string, content: string): Box | null {
  const x = readAttr(attrs, 'x');
  const y = readAttr(attrs, 'y');
  if (x === null || y === null) return null;

  const fontSize = readAttr(attrs, 'font-size') ?? DEFAULT_FONT_SIZE;
  const text = content.replace(/<[^>]*>/g, '').trim();
  if (!text) return null;

  const width = text.length * fontSize * GLYPH_WIDTH_RATIO;
  const anchor = attrs.match(/text-anchor\s*=\s*["']?\s*(middle|end|start)/i)?.[1]?.toLowerCase();
  const x1 = anchor === 'middle' ? x - width / 2 : anchor === 'end' ? x - width : x;

  return { x1, y1: y - fontSize * 0.8, x2: x1 + width, y2: y + fontSize * 0.2 };
}

/** Box of a filled shape, or null when it is transparent (cannot hide anything). */
function shapeBox(tag: string, attrs: string): Box | null {
  const fill = attrs.match(/fill\s*=\s*["']?\s*([^"'\s>]+)/i)?.[1]?.toLowerCase();
  if (fill === 'none' || fill === 'transparent') return null;

  const lower = tag.toLowerCase();

  if (lower === 'rect') {
    const x = readAttr(attrs, 'x');
    const y = readAttr(attrs, 'y');
    const w = readAttr(attrs, 'width');
    const h = readAttr(attrs, 'height');
    if (x === null || y === null || w === null || h === null) return null;
    return { x1: x, y1: y, x2: x + w, y2: y + h };
  }

  if (lower === 'circle' || lower === 'ellipse') {
    const cx = readAttr(attrs, 'cx');
    const cy = readAttr(attrs, 'cy');
    const rx = lower === 'circle' ? readAttr(attrs, 'r') : readAttr(attrs, 'rx');
    const ry = lower === 'circle' ? readAttr(attrs, 'r') : readAttr(attrs, 'ry');
    if (cx === null || cy === null || rx === null || ry === null) return null;
    return { x1: cx - rx, y1: cy - ry, x2: cx + rx, y2: cy + ry };
  }

  return null;
}

/**
 * Inspect an agent-written diagram for the failure modes the prompt asks it to
 * avoid but nothing checks: text too small to read, labels written over each
 * other, and labels buried under a shape painted after them.
 *
 * The checks are modelled on defects observed in real generated lessons, not
 * imagined ones. Rendering nine agent-written diagrams turned up three broken
 * ones, and the earlier version of this function caught none of them, because it
 * only compared `<text>` y-positions within the same 40px-wide column:
 *
 *  - A Venn diagram whose intersection ellipse was drawn AFTER the set labels, so
 *    "A: pares" rendered as "A: pare" and "B: múltiplos de 3" lost its prefix.
 *    Not a text-vs-text collision at all.
 *  - A scatter plot whose caption ran the full width of the figure straight
 *    through the axis labels. They overlapped horizontally, so the column
 *    buckets never compared them.
 *
 * So collisions are now computed as real box intersections, and shapes are
 * considered. Deliberately still advisory: geometry can be repaired
 * deterministically ({@link repairSvgGeometry}), layout cannot — moving a label
 * requires knowing what the diagram means. The warnings ride back in the tool
 * result and the model fixes its own work with `edit_lesson_content`.
 *
 * Returns [] for content with no SVG, which is the common case.
 */
export function validateSvgDiagram(content: string): string[] {
  const warnings: string[] = [];
  const svgBlocks = content.match(/<svg\b[\s\S]*?<\/svg>/gi);

  if (!svgBlocks?.length) return warnings;

  svgBlocks.forEach((svg, index) => {
    const label = svgBlocks.length > 1 ? `diagram ${index + 1}` : 'the diagram';

    const tooSmall = [...svg.matchAll(/font-size\s*=\s*["']?\s*([\d.]+)/gi)]
      .map((match) => Number.parseFloat(match[1]))
      .filter((size) => Number.isFinite(size) && size < MIN_READABLE_FONT_SIZE);

    if (tooSmall.length > 0) {
      warnings.push(
        `In ${label}, ${tooSmall.length} text element(s) use font-size below ${MIN_READABLE_FONT_SIZE} (smallest: ${Math.min(...tooSmall)}). Raise them to at least 14 and shorten the labels if they no longer fit.`
      );
    }

    // Walk elements in document order — painting order is what decides whether a
    // shape hides a label or merely sits behind it.
    const texts: Array<{ order: number; box: Box; text: string }> = [];
    const shapes: Array<{ order: number; box: Box }> = [];
    let order = 0;

    for (const match of svg.matchAll(/<(text|rect|circle|ellipse)\b([^>]*)(\/?)>/gi)) {
      const [, tag, attrs, selfClosing] = match;
      order += 1;

      if (tag.toLowerCase() === 'text') {
        if (selfClosing === '/') continue;
        const rest = svg.slice(match.index! + match[0].length);
        const inner = rest.slice(0, rest.search(/<\/text>/i) >= 0 ? rest.search(/<\/text>/i) : 0);
        const box = textBox(attrs, inner);
        if (box) texts.push({ order, box, text: inner.replace(/<[^>]*>/g, '').trim() });
        continue;
      }

      const box = shapeBox(tag, attrs);
      if (box) shapes.push({ order, box });
    }

    // A label covered by a shape painted later is invisible, not just crowded.
    const buried = texts.filter((t) =>
      shapes.some(
        (s) => s.order > t.order && intersectionArea(t.box, s.box) / Math.max(1, boxArea(t.box)) > OVERLAP_THRESHOLD
      )
    );

    if (buried.length > 0) {
      const sample = buried
        .slice(0, 3)
        .map((t) => `"${t.text.slice(0, 30)}"`)
        .join(', ');
      warnings.push(
        `In ${label}, ${buried.length} label(s) are painted over by a filled shape that comes later in the SVG (${sample}) and will be partly or fully hidden. Move those <text> elements after the shapes, or shift them out of the filled area.`
      );
    }

    // Real box intersection, so a wide caption crossing narrow axis labels counts
    // even though they sit in different columns.
    const overlapping: string[] = [];
    for (let i = 0; i < texts.length; i++) {
      for (let j = i + 1; j < texts.length; j++) {
        const area = intersectionArea(texts[i].box, texts[j].box);
        if (area / Math.max(1, Math.min(boxArea(texts[i].box), boxArea(texts[j].box))) > OVERLAP_THRESHOLD) {
          overlapping.push(`"${texts[i].text.slice(0, 22)}" / "${texts[j].text.slice(0, 22)}"`);
        }
      }
    }

    if (overlapping.length > 0) {
      warnings.push(
        `In ${label}, ${overlapping.length} pair(s) of labels overlap when rendered (${overlapping.slice(0, 3).join('; ')}). Give the caption its own band below the drawing and keep at least 40px between text rows.`
      );
    }
  });

  return warnings;
}

// ─── Math formulas ───────────────────────────────────────────────────────────

/**
 * Lesson math renders through KaTeX, which only looks at nodes shaped like
 * `<span data-type="inline-math" data-latex="…">` (see `renderMathInElement` in
 * @cio/ui, and ADD_ATTR in the sanitizer, which whitelists both attributes).
 *
 * Models write `$x$` instead, because that is what markdown training data looks
 * like — and `$x$` is not markup, so it reaches the learner as literal dollar
 * signs. Converting here rather than only asking the prompt not to do it: the
 * prompt rule steers, this guarantees, and the same normalization runs for every
 * writer (the agent, and any future import path).
 */
const PROTECTED_TEXT_TAGS = new Set(['code', 'pre', 'svg', 'script', 'style']);

/**
 * Applies `transform` to text nodes only — never inside a tag (which would
 * corrupt attributes) and never inside code/pre/svg (where a `$` is content,
 * not a delimiter).
 */
function mapTextNodes(html: string, transform: (text: string) => string): string {
  const tagPattern = /<\/?([a-zA-Z][\w-]*)\b[^>]*>/g;

  let result = '';
  let cursor = 0;
  let protectedDepth = 0;

  for (const match of html.matchAll(tagPattern)) {
    const text = html.slice(cursor, match.index);
    result += protectedDepth > 0 ? text : transform(text);
    result += match[0];
    cursor = match.index + match[0].length;

    if (PROTECTED_TEXT_TAGS.has(match[1].toLowerCase())) {
      if (match[0].startsWith('</')) protectedDepth = Math.max(0, protectedDepth - 1);
      else if (!match[0].endsWith('/>')) protectedDepth += 1;
    }
  }

  const tail = html.slice(cursor);

  return result + (protectedDepth > 0 ? tail : transform(tail));
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * The tag is not cosmetic. The lesson EDITOR parses math with
 * `span[data-type="inline-math"]` and `div[data-type="block-math"]`
 * (@tiptap/extension-mathematics) — a `<span data-type="block-math">` matches
 * neither, and since a math node is EMPTY (the formula lives in the attribute)
 * an unrecognised one is not just unstyled, it is dropped: the formula would be
 * destroyed the first time a teacher opened that lesson and saved.
 *
 * The viewer hid this, because `renderMathInElement` selects on the attribute
 * alone and accepts either tag.
 */
function mathNode(latex: string, display: boolean): string {
  const tag = display ? 'div' : 'span';

  return `<${tag} data-type="${display ? 'block' : 'inline'}-math" data-latex="${escapeAttribute(latex.trim())}"></${tag}>`;
}

/**
 * Is this `$…$` span really math, or a price?
 *
 * "$50" and "cuesta $30 y $40" must survive untouched, so a bare number is never
 * math, and an operator alone is not enough (`$10-$20` would qualify otherwise).
 * What does qualify: LaTeX syntax (backslash, braces, sub/superscript), a
 * relation, or a single bare identifier like `N` — the exact shapes seen in real
 * generated lessons.
 */
function looksLikeMath(inner: string): boolean {
  if (/^[\d.,\s]+$/.test(inner)) return false;

  return /[\\_^{}=/*+]/.test(inner) || /^[A-Za-z][A-Za-z0-9]{0,3}$/.test(inner);
}

function convertMathDelimiters(text: string): string {
  return (
    text
      // Display math first — `$$…$$` would otherwise be eaten as two inline spans.
      .replace(/\\\[([\s\S]{1,400}?)\\\]/g, (_full, latex: string) => mathNode(latex, true))
      .replace(/\$\$([^$]{1,400}?)\$\$/g, (_full, latex: string) => mathNode(latex, true))
      .replace(/\\\(([\s\S]{1,200}?)\\\)/g, (_full, latex: string) => mathNode(latex, false))
      // Newlines are allowed inside the span: `mapTextNodes` hands over text
      // nodes only, so a match can never run past the enclosing element.
      .replace(/\$(?!\s)([^$]{1,120}?)(?<!\s)\$/g, (full, latex: string) =>
        looksLikeMath(latex) ? mathNode(latex, false) : full
      )
  );
}

/**
 * LaTeX commands a formula actually uses. Deliberately a closed list rather than
 * "any `\word`": a code sample containing the regex `\d+`, or a Windows path,
 * must not be mistaken for maths.
 */
const MATH_MACROS =
  /\\(?:d?frac|tfrac|sum|prod|int|sqrt|cdot|times|div|pm|mp|leq?|geq?|neq?|approx|equiv|infty|partial|nabla|bar|hat|vec|overline|underline|left|right|binom|l?dots|cdots|log|ln|exp|sin|cos|tan|lim|max|min|alpha|beta|gamma|delta|Delta|var?epsilon|zeta|eta|theta|Theta|lambda|Lambda|mu|nu|xi|rho|sigma|Sigma|tau|phi|Phi|chi|psi|Psi|omega|Omega|pi|Pi|mathrm|mathbb|mathcal|text|q?quad|to|rightarrow|in|notin|subset|cup|cap|forall|exists)\b/;

/** Shapes that mean "this really is source code", checked before the macros. */
const CODE_MARKERS =
  /;\s*$|\/\/|\/\*|=>|::|#include|\b(?:function|const|let|var|def|class|import|export|return|print|println|console|printf|SELECT|INSERT|UPDATE|DELETE|public|private|static|void)\b/;

function decodeBasicEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#3[49];/g, "'")
    .replace(/&amp;/g, '&');
}

function codeLooksLikeMath(inner: string): boolean {
  // A formula is one line; a code sample rarely is. Cheap and very effective.
  if (/[\r\n]/.test(inner)) return false;
  if (CODE_MARKERS.test(inner)) return false;

  return MATH_MACROS.test(inner) || /[_^]\{/.test(inner);
}

/**
 * Rescues a formula parked in a `<code>` block.
 *
 * Models reach for `<code>` when they want a formula to stand out on its own
 * line, which is exactly wrong: it renders in monospace with every backslash
 * showing. Seen in 25 of the 32 lessons of one real course, so the prompt rule
 * against it does not carry on its own.
 *
 * Rendered inline rather than as a block on purpose. An inline span is valid
 * HTML wherever the `<code>` stood — a `<div>` inside a `<p>` would make the
 * parser close the paragraph early and orphan the rest of the sentence — and
 * these formulas sit next to a `<br>` or mid-sentence anyway. Inline KaTeX
 * renders fractions and sums correctly; it only sets them tighter.
 */
function convertCodeBlockMath(content: string): string {
  return content.replace(/<(code|pre)\b[^>]*>([\s\S]*?)<\/\1>/gi, (full, _tag: string, inner: string) => {
    // Anything with markup inside is not a bare formula — leave it alone.
    if (/<[a-zA-Z/]/.test(inner)) return full;

    const latex = decodeBasicEntities(inner).trim();

    return latex && codeLooksLikeMath(latex) ? mathNode(latex, false) : full;
  });
}

/**
 * Repairs block math written as a `<span>`.
 *
 * The shape this codebase emitted for one day, and the shape a model still
 * produces from memory. The viewer renders it, so it looks correct — and the
 * editor, which parses block math as a `div`, silently drops it on the next
 * save. Only ever an empty node: one with content is something else.
 */
function repairBlockMathTag(content: string): string {
  return content.replace(
    /<span(\s[^>]*\bdata-type="block-math"[^>]*)><\/span>/gi,
    (_full, attrs: string) => `<div${attrs}></div>`
  );
}

/**
 * Lifts a display formula out of a paragraph that holds nothing else.
 *
 * `block-math` is a `<div>` (see `mathNode`), and a `<div>` inside a `<p>` makes
 * the parser close the paragraph early. When the formula IS the paragraph — the
 * usual shape for display math — dropping the wrapper avoids that entirely.
 */
function hoistBlockMath(content: string): string {
  return content.replace(
    /<p\b[^>]*>\s*(<div data-type="block-math"[^>]*><\/div>)\s*<\/p>/gi,
    (_full, node: string) => node
  );
}

/**
 * Rewrites markdown-style math into the KaTeX nodes the lesson renderer reads.
 *
 * Exported for the same reason as `repairSvgGeometry`: `edit_lesson_content` and
 * `replace_lesson_block` write fragments straight into stored content without
 * going through `normalizeAgentLessonContent`, so without this they would be the
 * one way `$…$` still reaches a learner. `backfill-lesson-math.ts` runs it over
 * already-stored lessons, which is why it has to stay idempotent.
 */
export function convertMarkdownMathToKatex(content: string): string {
  // Code blocks first: `mapTextNodes` protects their insides, so rescuing them
  // afterwards would leave any delimiters they hold behind.
  const rescued = convertCodeBlockMath(repairBlockMathTag(content));

  return hoistBlockMath(mapTextNodes(rescued, convertMathDelimiters));
}

const LATEX_MARKERS = /\\(?:frac|sum|int|sqrt|alpha|beta|mu|sigma|pi|cdot|times|leq|geq|neq)\b|[_^]\{/;

/**
 * Formula problems left after conversion, handed back so the model can fix its
 * own work — the same loop `validateSvgDiagram` runs for diagrams.
 */
export function validateLessonMath(content: string): string[] {
  const warnings: string[] = [];

  // Mirrors the converter's own judgement rather than its size limit: a `$…$`
  // span that reads as maths but is too long to rewrite safely is exactly the
  // case worth reporting, and "cuesta $50 y $60" still must not warn.
  let leftover = 0;
  mapTextNodes(content, (text) => {
    const hasTexDelimiters = /\\\(|\\\[/.test(text);
    const hasUnconverted = [...text.matchAll(/\$([^$]{1,400})\$/g)].some((match) => looksLikeMath(match[1]));

    if (hasTexDelimiters || hasUnconverted) leftover += 1;

    return text;
  });

  if (leftover > 0) {
    warnings.push(
      `${leftover} text block(s) still contain markdown-style math delimiters ($…$, \\(…\\) or \\[…\\]). Those render as literal dollar signs and backslashes for the learner. Rewrite each formula as <span data-type="inline-math" data-latex="…"></span>, or <div data-type="block-math" data-latex="…"></div> for a standalone equation.`
    );
  }

  const codeMath = [...content.matchAll(/<(code|pre)\b[^>]*>([\s\S]*?)<\/\1>/gi)].filter((match) =>
    LATEX_MARKERS.test(match[2])
  );

  if (codeMath.length > 0) {
    warnings.push(
      `${codeMath.length} code block(s) contain what looks like a formula rather than code. A formula inside <code> renders in monospace with the LaTeX showing. Move it to <span data-type="inline-math" data-latex="…"></span>, or <div data-type="block-math" data-latex="…"></div> if it stands on its own line.`
    );
  }

  // KaTeX only walks HTML: `renderMathInElement` queries for data-type="…-math"
  // spans, and SVG <text> is not HTML, so it is never visited. LaTeX inside a
  // diagram is therefore GUARANTEED to reach the learner as raw source — and
  // since the source is far longer than the formula it denotes, it overruns the
  // box it was measured for. Unicode is the only thing that renders in an SVG.
  const svgLatex = [...content.matchAll(/<svg\b[\s\S]*?<\/svg>/gi)].filter((match) =>
    /\$[^$]{1,120}\$|\\\(|\\\[|\\[a-zA-Z]{2,}|[_^]\{/.test(match[0])
  );

  if (svgLatex.length > 0) {
    warnings.push(
      `${svgLatex.length} diagram(s) contain LaTeX inside SVG <text>. KaTeX never renders inside an SVG, so it shows as raw source AND overflows its box. Rewrite those labels with Unicode characters instead (χ² σ₀² α β μ σ ≤ ≥ ≠ √ Σ ∫ ± ∞), which render correctly in SVG.`
    );
  }

  return warnings;
}

export function normalizeAgentLessonContent(content: string, lessonTitle: string): string {
  let normalizedContent = content.trim();

  normalizedContent = stripLeadingLessonTitle(normalizedContent, lessonTitle);
  normalizedContent = normalizeHeadingLevels(normalizedContent);
  normalizedContent = repairSvgGeometry(normalizedContent);
  normalizedContent = convertMarkdownMathToKatex(normalizedContent);

  return normalizedContent.trim();
}

/** Exposed so edit_lesson_content (which bypasses full normalization) can still
 *  repair SVG geometry on the fragments it writes. */
export { repairSvgGeometry };
