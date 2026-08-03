/**
 * Seeding the canvas by MEASURING the template, instead of guessing at it.
 *
 * The first version recreated each of the five layouts as hand-placed boxes, and
 * every one of them came out visibly different from the template it claimed to
 * be. That was never going to converge: the originals are CSS that reflows —
 * flex columns, grid footers, `clamp()` sizes in `vw` — and a canvas is fixed
 * coordinates. Matching one by eye is a fight you lose again on the next
 * template and on the next course title.
 *
 * So instead of describing the layout, we let the browser lay it out and then
 * read the answer. The same `renderCertificateDocument` the preview already
 * uses goes into an offscreen iframe at exactly 1100x780 — no scaling, so
 * measured pixels ARE canvas units — and every visible node comes back as an
 * element with its real rect and its real computed style. The result matches by
 * construction, for every template, and keeps matching if a template's CSS
 * changes.
 *
 * Two things this cannot see, both handled explicitly below: `::before` /
 * `::after` decoration (no node to measure) and which words were data rather
 * than design.
 */
import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  renderCertificateDocument,
  type BindingValues,
  type CertificateDesign,
  type CertificateDocument,
  type CertificateElement,
  type CertificateRenderData,
  type HorizontalAlign,
  type TextElement
} from '@cio/certificates';

/** Give the iframe a moment to fetch fonts; measuring before they land is the whole failure. */
const FONT_TIMEOUT_MS = 3000;

const TRANSPARENT = new Set(['rgba(0, 0, 0, 0)', 'transparent']);

function isVisible(style: CSSStyleDeclaration): boolean {
  return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0;
}

function hasPaint(style: CSSStyleDeclaration): boolean {
  const background = !TRANSPARENT.has(style.backgroundColor);
  const border = ['Top', 'Right', 'Bottom', 'Left'].some(
    (side) =>
      parseFloat(style.getPropertyValue(`border-${side.toLowerCase()}-width`)) > 0 &&
      !TRANSPARENT.has(style.getPropertyValue(`border-${side.toLowerCase()}-color`))
  );

  return background || border;
}

/** Text that belongs to THIS node, not to its descendants. */
function ownText(node: Element): string {
  return Array.from(node.childNodes)
    .filter((child) => child.nodeType === Node.TEXT_NODE)
    .map((child) => child.textContent ?? '')
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

function toAlign(value: string): HorizontalAlign {
  if (value === 'right' || value === 'end') return 'right';
  if (value === 'center') return 'center';

  return 'left';
}

/** `rgb(42, 24, 16)` → `#2a1810`; anything unparseable falls back to black. */
function toHex(value: string): string {
  const match = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(value);
  if (!match) return '#000000';

  return (
    '#' +
    [match[1], match[2], match[3]]
      .map((part) => Number(part).toString(16).padStart(2, '0'))
      .join('')
  );
}

function familyOf(style: CSSStyleDeclaration): string {
  // `font-family` comes back as the full stack; the first entry is the face the
  // template asked for, which is the one the fit engine has metrics for.
  return (style.fontFamily.split(',')[0] ?? '').replace(/["']/g, '').trim() || 'Space Grotesk';
}

function lineHeightOf(style: CSSStyleDeclaration): number {
  const size = parseFloat(style.fontSize) || 16;
  const raw = parseFloat(style.lineHeight);

  return Number.isFinite(raw) && raw > 0 ? Math.min(4, Math.max(0.5, raw / size)) : 1.2;
}

/**
 * Put the data back into tokens.
 *
 * The measured DOM holds "Samuel Paredes" where the design means
 * `{{recipientName}}`. Without this the canvas would freeze one recipient's name
 * into the layout and print it on every certificate the course ever issues.
 * Longest values first, so a short one nested inside a long one (a year inside a
 * date) does not shadow it.
 */
function tokenize(text: string, values: BindingValues): string {
  const entries = (Object.entries(values) as [keyof BindingValues, string][])
    .filter(([, value]) => value.trim().length > 2)
    .sort((a, b) => b[1].length - a[1].length);

  let result = text;

  for (const [key, value] of entries) {
    if (result.includes(value)) result = result.split(value).join(`{{${key}}}`);
  }

  return result;
}

/**
 * Decoration drawn with `::before` / `::after`.
 *
 * There is no node to measure, so the rect is derived from the pseudo's own
 * computed `inset` against its host. Only absolutely positioned ones are
 * recoverable, which happens to be exactly what the templates use them for:
 * the double frames and the dashed ring inside the seal.
 */
function pseudoElements(host: Element, hostRect: DOMRect, origin: DOMRect, idPrefix: string): CertificateElement[] {
  const view = host.ownerDocument.defaultView;
  if (!view) return [];

  const found: CertificateElement[] = [];

  for (const pseudo of ['::before', '::after'] as const) {
    const style = view.getComputedStyle(host, pseudo);

    if (style.content === 'none' || style.position !== 'absolute' || !hasPaint(style)) continue;

    const inset = (side: string) => parseFloat(style.getPropertyValue(side));
    const top = inset('top');
    const left = inset('left');
    const right = inset('right');
    const bottom = inset('bottom');

    if (![top, left, right, bottom].every(Number.isFinite)) continue;

    const width = hostRect.width - left - right;
    const height = hostRect.height - top - bottom;
    if (width <= 0 || height <= 0) continue;

    const borderWidth = parseFloat(style.borderTopWidth) || 0;
    const radius = parseFloat(style.borderTopLeftRadius) || 0;

    found.push({
      kind: 'shape',
      id: `${idPrefix}-${pseudo.replace('::', '')}`,
      x: Math.round(hostRect.left - origin.left + left),
      y: Math.round(hostRect.top - origin.top + top),
      w: Math.round(width),
      h: Math.round(height),
      shape: radius >= Math.min(width, height) / 2 ? 'ellipse' : 'rect',
      ...(borderWidth > 0 ? { strokeColor: toHex(style.borderTopColor), strokeWidth: Math.round(borderWidth) } : {}),
      ...(TRANSPARENT.has(style.backgroundColor) ? {} : { fill: toHex(style.backgroundColor) })
    });
  }

  return found;
}

function measureInto(root: Element, origin: DOMRect, values: BindingValues): CertificateElement[] {
  const view = root.ownerDocument.defaultView;
  if (!view) return [];

  const elements: CertificateElement[] = [];
  let counter = 0;

  const walk = (node: Element) => {
    const style = view.getComputedStyle(node);
    if (!isVisible(style)) return;

    const rect = node.getBoundingClientRect();
    const id = `m${counter++}`;
    const x = Math.round(rect.left - origin.left);
    const y = Math.round(rect.top - origin.top);
    const w = Math.round(rect.width);
    const h = Math.round(rect.height);

    elements.push(...pseudoElements(node, rect, origin, id));

    const text = ownText(node);

    if (text) {
      const fontSize = Math.round(parseFloat(style.fontSize)) || 16;

      const element: TextElement = {
        kind: 'text',
        id,
        x,
        y,
        // Measured boxes are exactly as wide as the laid-out text, and the fit
        // engine keeps 6% in hand — so a box copied verbatim would be shrunk
        // the moment it is re-fitted. Growing it back means the canvas opens
        // showing the size the template actually rendered.
        w: Math.max(1, Math.round(w / 0.92)),
        h: Math.max(1, Math.round(h / 0.92)),
        content: tokenize(text, values),
        fit: 'shrink',
        minFontSize: Math.max(8, Math.round(fontSize * 0.45)),
        style: {
          fontFamily: familyOf(style),
          fontSize,
          fontWeight: Number(style.fontWeight) || 400,
          lineHeight: lineHeightOf(style),
          letterSpacing: parseFloat(style.letterSpacing) || 0,
          color: toHex(style.color),
          align: toAlign(style.textAlign),
          verticalAlign: 'middle',
          ...(style.fontStyle === 'italic' ? { italic: true } : {}),
          ...(style.textTransform === 'uppercase' ? { uppercase: true } : {})
        }
      };

      // The box was grown around its measured position, so recentre it.
      element.x = Math.round(x - (element.w - w) / 2);
      element.y = Math.round(y - (element.h - h) / 2);

      elements.push(element);
    } else if (hasPaint(style) && w > 0 && h > 0) {
      const borderWidth = parseFloat(style.borderTopWidth) || 0;
      const radius = parseFloat(style.borderTopLeftRadius) || 0;

      elements.push({
        kind: 'shape',
        id,
        x,
        y,
        w,
        h,
        shape: radius >= Math.min(w, h) / 2 ? 'ellipse' : 'rect',
        ...(radius > 0 && radius < Math.min(w, h) / 2 ? { radius: Math.round(radius) } : {}),
        ...(borderWidth > 0 ? { strokeColor: toHex(style.borderTopColor), strokeWidth: Math.round(borderWidth) } : {}),
        ...(TRANSPARENT.has(style.backgroundColor) ? {} : { fill: toHex(style.backgroundColor) })
      });
    }

    for (const child of Array.from(node.children)) walk(child);
  };

  for (const child of Array.from(root.children)) walk(child);

  return elements;
}

/**
 * Render `design` offscreen and return it as a canvas document.
 *
 * Resolves to `null` rather than throwing when measuring is not possible — no
 * DOM, a blocked iframe, fonts that never arrive — so the caller can fall back
 * to the hand-authored preset instead of leaving the teacher with nothing.
 */
export async function measureTemplateAsDocument(
  design: CertificateDesign,
  data: CertificateRenderData,
  values: BindingValues
): Promise<CertificateDocument | null> {
  if (typeof window === 'undefined' || typeof document === 'undefined') return null;

  const frame = document.createElement('iframe');
  // Offscreen at full size: measuring a scaled copy would give scaled pixels,
  // and every coordinate would be wrong by the zoom factor.
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = `position:fixed;left:-10000px;top:0;width:${CANVAS_WIDTH}px;height:${CANVAS_HEIGHT}px;border:0;visibility:hidden`;

  document.body.appendChild(frame);

  try {
    const loaded = new Promise<void>((resolve) => {
      frame.addEventListener('load', () => resolve(), { once: true });
    });

    frame.srcdoc = renderCertificateDocument(design, data);
    await loaded;

    const inner = frame.contentDocument;
    if (!inner) return null;

    // Text measured against a fallback face lands in the wrong place, which is
    // the single most likely way for this to produce a bad layout.
    await Promise.race([
      inner.fonts?.ready ?? Promise.resolve(),
      new Promise((resolve) => setTimeout(resolve, FONT_TIMEOUT_MS))
    ]);

    const cert = inner.querySelector('.cert');
    if (!cert) return null;

    const origin = cert.getBoundingClientRect();
    const certStyle = frame.contentWindow!.getComputedStyle(cert);

    const elements = measureInto(cert, origin, values);
    if (elements.length === 0) return null;

    return {
      version: 2,
      canvas: {
        color: TRANSPARENT.has(certStyle.backgroundColor) ? '#ffffff' : toHex(certStyle.backgroundColor)
      },
      elements
    };
  } catch {
    return null;
  } finally {
    frame.remove();
  }
}
