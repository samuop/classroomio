/**
 * Deciding what size text has to be to fit its box — without a browser.
 *
 * The preview runs this in the teacher's browser and the export runs it in Node
 * before handing HTML to Cloudflare. Both must reach the SAME number, because
 * the whole promise of the editor is that what you see is what gets issued. So
 * the measurement is a pure function of the string and the style: no DOM, no
 * canvas `measureText`, no `document.fonts`. If this ever starts measuring in
 * the browser to be more accurate, preview and export drift apart and the
 * guarantee is gone — that is the trade being made here on purpose.
 *
 * The cost is that widths are ESTIMATES, from per-family average advance
 * widths. They are close enough to keep text inside its box (which is what
 * matters), not close enough to typeset with. Where the estimate is wrong it is
 * deliberately biased wide, so the failure mode is text slightly smaller than
 * it needed to be rather than text spilling over a seal.
 */
import type { TextElement, TextStyle } from './types';

/**
 * Average glyph advance as a fraction of the font size, per family.
 *
 * Measured from the families already loaded by `FONTS_LINK_HREF`. Display
 * serifs like Cormorant are narrow; all-caps faces like Cinzel and monospace
 * faces are wide. An unknown family falls back to `DEFAULT_ADVANCE`, which sits
 * on the wide side of typical so an unrecognised font shrinks rather than
 * overflows.
 */
export const FONT_ADVANCE_RATIOS: Record<string, number> = {
  'Cormorant Garamond': 0.42,
  'Bodoni Moda': 0.46,
  'Playfair Display': 0.48,
  Cinzel: 0.58,
  'Archivo Black': 0.6,
  'Space Grotesk': 0.52,
  'DM Mono': 0.6,
  'JetBrains Mono': 0.6
};

export const DEFAULT_ADVANCE = 0.55;

/** Uppercase glyphs are wider than the mixed-case average the ratios describe. */
const UPPERCASE_FACTOR = 1.15;

/** Bold faces set slightly wider than their regular cut. */
const BOLD_FACTOR = 1.04;
const BOLD_THRESHOLD = 600;

export function advanceRatioFor(style: Pick<TextStyle, 'fontFamily' | 'fontWeight' | 'uppercase'>): number {
  const base = FONT_ADVANCE_RATIOS[style.fontFamily] ?? DEFAULT_ADVANCE;
  const weighted = style.fontWeight >= BOLD_THRESHOLD ? base * BOLD_FACTOR : base;

  return style.uppercase ? weighted * UPPERCASE_FACTOR : weighted;
}

/** Estimated rendered width of a single line, in canvas units. */
export function estimateTextWidth(
  text: string,
  fontSize: number,
  style: Pick<TextStyle, 'fontFamily' | 'fontWeight' | 'uppercase' | 'letterSpacing'>
): number {
  if (text.length === 0) return 0;

  const perGlyph = fontSize * advanceRatioFor(style);

  // Letter-spacing applies between glyphs, so a 5-character word gets four
  // gaps. Using `length` instead would over-report short strings noticeably at
  // the wide tracking display templates use.
  return text.length * perGlyph + Math.max(0, text.length - 1) * style.letterSpacing;
}

/**
 * Greedy word wrap against a pixel width.
 *
 * Greedy is what browsers do for normal text, so the line COUNT matches even
 * though the exact break points may differ by a word. A single word longer than
 * the box is hard-broken rather than allowed to stick out, matching
 * `overflow-wrap: break-word` in the rendered CSS.
 */
export function wrapText(
  text: string,
  boxWidth: number,
  fontSize: number,
  style: Pick<TextStyle, 'fontFamily' | 'fontWeight' | 'uppercase' | 'letterSpacing'>
): string[] {
  if (boxWidth <= 0) return text.length > 0 ? [text] : [];

  const lines: string[] = [];

  for (const paragraph of text.split('\n')) {
    if (paragraph.trim().length === 0) {
      lines.push('');
      continue;
    }

    let current = '';

    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = current ? `${current} ${word}` : word;

      if (estimateTextWidth(candidate, fontSize, style) <= boxWidth) {
        current = candidate;
        continue;
      }

      if (current) {
        lines.push(current);
        current = '';
      }

      // The word alone is too wide: break it into chunks that do fit.
      if (estimateTextWidth(word, fontSize, style) > boxWidth) {
        let chunk = '';

        for (const char of word) {
          if (estimateTextWidth(chunk + char, fontSize, style) > boxWidth && chunk) {
            lines.push(chunk);
            chunk = char;
          } else {
            chunk += char;
          }
        }

        current = chunk;
      } else {
        current = word;
      }
    }

    if (current) lines.push(current);
  }

  return lines.length > 0 ? lines : [''];
}

export interface FitResult {
  /** The size to actually render at. Equal to the style size unless shrunk. */
  fontSize: number;
  lines: number;
  /** Hard line cap for the CSS, when the rule is `clamp`. */
  maxLines?: number;
  /**
   * True when the text still does not fit at the size returned. The renderer
   * prints it anyway — a certificate with slightly crowded text beats a blank
   * one — but the editor surfaces it so a teacher can fix the design before
   * anything is issued.
   */
  overflows: boolean;
}

/** Below this, a certificate stops being legible; `shrink` never goes further. */
export const DEFAULT_MIN_FONT_SIZE = 10;

/**
 * Headroom the fit leaves inside the box.
 *
 * Widths here are ESTIMATES, so a fit that fills the box exactly is a fit that
 * overflows the moment the estimate is off by a percent — and it will be. The
 * first version accepted a title at 915 estimated pixels in a 920px box and the
 * real text ran out over its neighbours.
 *
 * It also absorbs the case that actually bites in practice: the requested font
 * has not loaded, so the browser is laying the text out in a fallback with
 * different metrics. The renderer's fonts come over the network, and a
 * stylesheet can be slow, blocked by a policy, or simply unavailable.
 *
 * 6% is roughly one character at a typical line length — enough to cover
 * estimate drift, cheap enough that nothing is visibly smaller than it should be.
 */
const FIT_SAFETY = 0.94;

/** Shrinking proceeds in whole points: predictable, and fast to reason about. */
const SHRINK_STEP = 1;

/**
 * Resolve the size and line count for a text element against its box.
 *
 * `resolvedText` is the content AFTER binding substitution — fitting the raw
 * "{{recipientName}}" token would size the box for the placeholder rather than
 * for the name that replaces it.
 */
export function fitText(
  element: Pick<TextElement, 'style' | 'fit' | 'minFontSize' | 'maxLines' | 'w' | 'h'>,
  resolvedText: string
): FitResult {
  const { style } = element;
  const text = style.uppercase ? resolvedText.toUpperCase() : resolvedText;

  // Both axes get the margin: a line count derived from an over-optimistic
  // width is wrong about the height too.
  const usableWidth = element.w * FIT_SAFETY;
  const usableHeight = element.h * FIT_SAFETY;

  const linesAt = (size: number) => wrapText(text, usableWidth, size, style).length;
  const heightAt = (size: number, lineCount: number) => lineCount * size * style.lineHeight;

  if (element.fit === 'clamp') {
    const lineCount = linesAt(style.fontSize);
    // Whatever the caller asked for, never more lines than the box can hold —
    // a maxLines of 6 in a two-line box would clamp at a height nothing sees.
    const boxLines = Math.max(1, Math.floor(usableHeight / (style.fontSize * style.lineHeight)));
    const cap = Math.max(1, Math.min(element.maxLines ?? boxLines, boxLines));

    return {
      fontSize: style.fontSize,
      lines: Math.min(lineCount, cap),
      maxLines: cap,
      overflows: lineCount > cap
    };
  }

  if (element.fit === 'overflow') {
    const lineCount = linesAt(style.fontSize);

    return {
      fontSize: style.fontSize,
      lines: lineCount,
      overflows: heightAt(style.fontSize, lineCount) > usableHeight
    };
  }

  const floor = Math.max(1, element.minFontSize ?? DEFAULT_MIN_FONT_SIZE);

  for (let size = style.fontSize; size >= floor; size -= SHRINK_STEP) {
    const lineCount = linesAt(size);

    if (heightAt(size, lineCount) <= usableHeight) {
      return { fontSize: size, lines: lineCount, overflows: false };
    }
  }

  // Even at the floor it does not fit. Render at the floor and report it: the
  // alternative is shrinking text to an unreadable size to satisfy a box that
  // is simply too small for the data.
  const lineCount = linesAt(floor);

  return { fontSize: floor, lines: lineCount, overflows: true };
}
