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

export function normalizeAgentLessonContent(content: string, lessonTitle: string): string {
  let normalizedContent = content.trim();

  normalizedContent = stripLeadingLessonTitle(normalizedContent, lessonTitle);
  normalizedContent = normalizeHeadingLevels(normalizedContent);
  normalizedContent = repairSvgGeometry(normalizedContent);

  return normalizedContent.trim();
}

/** Exposed so edit_lesson_content (which bypasses full normalization) can still
 *  repair SVG geometry on the fragments it writes. */
export { repairSvgGeometry };
