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
/** Two <text> nodes closer than this on the y axis will visually collide. */
const MIN_TEXT_ROW_GAP = 10;

/**
 * Inspect an agent-written diagram for the failure modes the prompt asks it to
 * avoid but nothing ever checked: text too small to read, and labels stacked on
 * top of each other.
 *
 * Deliberately advisory. Geometry can be repaired deterministically
 * ({@link repairSvgGeometry}); layout cannot — moving a label to fix an overlap
 * requires knowing what the diagram means. So instead of silently accepting a
 * broken diagram or mangling it, the warnings ride back in the tool result and the
 * model fixes its own work with `edit_lesson_content`.
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

    // Group <text> y positions by x so we only flag labels that actually share a
    // column — two labels at the same y in different columns are fine.
    const byColumn = new Map<number, number[]>();

    for (const match of svg.matchAll(/<text\b([^>]*)>/gi)) {
      const attrs = match[1];
      const x = Number.parseFloat(attrs.match(/\bx\s*=\s*["']?\s*([\d.]+)/i)?.[1] ?? '');
      const y = Number.parseFloat(attrs.match(/\by\s*=\s*["']?\s*([\d.]+)/i)?.[1] ?? '');

      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;

      // Round x into 40px buckets so near-aligned labels count as one column.
      const column = Math.round(x / 40);
      byColumn.set(column, [...(byColumn.get(column) ?? []), y]);
    }

    const collisions = [...byColumn.values()].reduce((count, ys) => {
      const sorted = [...ys].sort((a, b) => a - b);
      let overlaps = 0;
      for (let i = 1; i < sorted.length; i++) {
        if (sorted[i] - sorted[i - 1] < MIN_TEXT_ROW_GAP) overlaps += 1;
      }
      return count + overlaps;
    }, 0);

    if (collisions > 0) {
      warnings.push(
        `In ${label}, ${collisions} pair(s) of text labels sit less than ${MIN_TEXT_ROW_GAP}px apart vertically in the same column and will overlap when rendered. Space rows at least 40px apart, or split long labels across two <text> lines.`
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
