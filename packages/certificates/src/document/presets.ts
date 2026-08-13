/**
 * Starting points for the canvas.
 *
 * A blank 1100x780 rectangle is a terrible place to begin designing a
 * certificate, so switching a course to free layout seeds the canvas from the
 * template it was already using, carrying across the wording, signatories and
 * accent colour the teacher had set. What they see the moment the editor opens
 * is their own certificate, now made of movable pieces.
 *
 * These are FAITHFUL RECREATIONS, not pixel clones. The originals lean on flex
 * and grid to reflow; a canvas cannot, so proportions are matched by hand and
 * the differences are a few pixels of spacing. The originals stay in the
 * codebase and keep rendering every course that has not switched, so this is a
 * new door rather than a migration.
 *
 * Every preset carries BOTH brand slots — the issuing organisation's logo and
 * the client company's — positioned and ready. A consultancy certifying on
 * behalf of a client should not have to build that itself, and the slots hide
 * themselves when a course has no client set.
 */
import type { CertificateDesign, CertificateTemplateId } from '../types';
import { resolveLabels } from '../constants';
import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  type CertificateDocument,
  type CertificateElement,
  type HorizontalAlign,
  type ImageElement,
  type ShapeElement,
  type TextElement,
  type TextFit,
  type VerticalAlign
} from './types';

interface TextSpec {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  content: string;
  family: string;
  size: number;
  weight?: number;
  color: string;
  align?: HorizontalAlign;
  verticalAlign?: VerticalAlign;
  lineHeight?: number;
  tracking?: number;
  italic?: boolean;
  uppercase?: boolean;
  fit?: TextFit;
  minFontSize?: number;
  maxLines?: number;
}

function text(spec: TextSpec): TextElement {
  return {
    kind: 'text',
    id: spec.id,
    x: spec.x,
    y: spec.y,
    w: spec.w,
    h: spec.h,
    content: spec.content,
    fit: spec.fit ?? 'shrink',
    ...(spec.minFontSize !== undefined ? { minFontSize: spec.minFontSize } : {}),
    ...(spec.maxLines !== undefined ? { maxLines: spec.maxLines } : {}),
    style: {
      fontFamily: spec.family,
      fontSize: spec.size,
      fontWeight: spec.weight ?? 400,
      lineHeight: spec.lineHeight ?? 1.2,
      letterSpacing: spec.tracking ?? 0,
      color: spec.color,
      align: spec.align ?? 'center',
      verticalAlign: spec.verticalAlign ?? 'middle',
      ...(spec.italic ? { italic: true } : {}),
      ...(spec.uppercase ? { uppercase: true } : {})
    }
  };
}

function rule(
  id: string,
  x: number,
  y: number,
  length: number,
  color: string,
  thickness = 1,
  orientation: 'horizontal' | 'vertical' = 'horizontal'
): ShapeElement {
  // A `line` collapses to its stroke on the cross axis, so a vertical rule is
  // the same shape with the dimensions swapped rather than a separate kind.
  const size = orientation === 'horizontal' ? { w: length, h: thickness } : { w: thickness, h: length };

  return { kind: 'shape', id, shape: 'rect', x, y, ...size, fill: color };
}

/**
 * The two brand slots. `hideWhenEmpty` is the default, so a course with no
 * client logo simply prints nothing there instead of a broken image — the org
 * slot behaves the same way for an organisation that never uploaded an avatar.
 */
function brandSlots(
  org: { x: number; y: number; w: number; h: number },
  client: { x: number; y: number; w: number; h: number }
): ImageElement[] {
  return [
    { kind: 'image', id: 'org-logo', ...org, source: { kind: 'orgLogo' }, fit: 'contain' },
    { kind: 'image', id: 'client-logo', ...client, source: { kind: 'clientLogo' }, fit: 'contain' }
  ];
}

function signaturePair(
  accent: string,
  ink: string,
  nameFamily: string,
  roleFamily: string,
  design: CertificateDesign,
  y: number
): CertificateElement[] {
  const [one, two] = design.signatories;

  return [
    rule('sig-1-rule', 110, y, 260, accent),
    text({ id: 'sig-1-name', x: 110, y: y + 6, w: 260, h: 28, content: one.name, family: nameFamily, size: 20, color: ink, italic: true }),
    text({ id: 'sig-1-role', x: 110, y: y + 34, w: 260, h: 16, content: one.role, family: roleFamily, size: 10, color: accent, tracking: 3, uppercase: true }),
    rule('sig-2-rule', 730, y, 260, accent),
    text({ id: 'sig-2-name', x: 730, y: y + 6, w: 260, h: 28, content: two.name, family: nameFamily, size: 20, color: ink, italic: true }),
    text({ id: 'sig-2-role', x: 730, y: y + 34, w: 260, h: 16, content: two.role, family: roleFamily, size: 10, color: accent, tracking: 3, uppercase: true })
  ];
}

/**
 * The engraved corner brackets classique draws with `border-*: none` on a
 * square. A canvas shape has one uniform border, so each bracket is two rules —
 * which is also what makes them individually movable, unlike the CSS original.
 */
function cornerBrackets(accent: string, inset: number, arm: number): CertificateElement[] {
  const right = CANVAS_WIDTH - inset;
  const bottom = CANVAS_HEIGHT - inset;

  return [
    rule('corner-tl-h', inset, inset, arm, accent),
    rule('corner-tl-v', inset, inset, arm, accent, 1, 'vertical'),
    rule('corner-tr-h', right - arm, inset, arm, accent),
    rule('corner-tr-v', right, inset, arm, accent, 1, 'vertical'),
    rule('corner-bl-h', inset, bottom, arm, accent),
    rule('corner-bl-v', inset, bottom - arm, arm, accent, 1, 'vertical'),
    rule('corner-br-h', right - arm, bottom, arm, accent),
    rule('corner-br-v', right, bottom - arm, arm, accent, 1, 'vertical')
  ];
}

function classiquePreset(design: CertificateDesign): CertificateDocument {
  const accent = design.accentColor;
  const ink = '#2a1810';
  const labels = resolveLabels(design.labels);

  const elements: CertificateElement[] = [
    // The inner of the two rules classique draws; the outer one is the canvas
    // border. `border: 2px double` is a single CSS declaration and two drawn
    // lines, so recreating it takes two elements here.
    {
      kind: 'shape',
      id: 'inner-frame',
      shape: 'rect',
      x: 42,
      y: 42,
      w: CANVAS_WIDTH - 84,
      h: CANVAS_HEIGHT - 84,
      strokeColor: accent,
      strokeWidth: 1
    },
    ...cornerBrackets(accent, 55, 80),
    ...brandSlots({ x: 70, y: 60, w: 130, h: 56 }, { x: 900, y: 60, w: 130, h: 56 }),
    text({ id: 'org', x: 200, y: 70, w: 700, h: 22, content: '{{orgName}}', family: 'Cinzel', size: 13, color: accent, tracking: 7.8, uppercase: true }),
    text({ id: 'ornament', x: 200, y: 104, w: 700, h: 30, content: '❦', family: 'Cinzel', size: 24, color: accent, tracking: 12 }),
    text({ id: 'title', x: 90, y: 140, w: 920, h: 104, content: '{{courseName}}', family: 'Bodoni Moda', size: 66, color: ink, italic: true, lineHeight: 1.06, minFontSize: 32, maxLines: 3 }),
    text({ id: 'subtitle', x: 90, y: 252, w: 920, h: 24, content: design.subtitle ?? '', family: 'Cinzel', size: 14, color: accent, tracking: 6.3, uppercase: true }),
    text({ id: 'presented', x: 90, y: 292, w: 920, h: 26, content: labels.presented ? `— ${labels.presented} —` : '', family: 'Cormorant Garamond', size: 18, color: '#5a3a25', italic: true }),
    text({ id: 'recipient', x: 210, y: 324, w: 680, h: 72, content: '{{recipientName}}', family: 'Bodoni Moda', size: 56, color: ink, lineHeight: 1.05, minFontSize: 26, maxLines: 2 }),
    rule('recipient-rule', 210, 400, 680, accent, 2),
    text({ id: 'description', x: 200, y: 418, w: 700, h: 116, content: design.descriptionOverride || '{{courseDescription}}', family: 'Cormorant Garamond', size: 18, color: '#3a2515', italic: true, lineHeight: 1.6, fit: 'clamp', maxLines: 4 }),
    { kind: 'shape', id: 'seal', shape: 'ellipse', x: 490, y: 578, w: 120, h: 120, strokeColor: accent, strokeWidth: 2 },
    // Three stacked lines, matching the template's star / year / reference. The
    // year was missing entirely before, which is the difference that read most
    // obviously as "the canvas is not the same certificate".
    text({ id: 'seal-star', x: 490, y: 596, w: 120, h: 24, content: '★', family: 'Cinzel', size: 18, color: accent }),
    text({ id: 'seal-year', x: 490, y: 620, w: 120, h: 26, content: '{{year}}', family: 'Cinzel', size: 18, weight: 600, color: accent }),
    text({ id: 'seal-id', x: 490, y: 648, w: 120, h: 18, content: '{{certificateId}}', family: 'Cinzel', size: 8, color: accent, tracking: 1.6, fit: 'shrink', minFontSize: 6 }),
    ...signaturePair(accent, ink, 'Bodoni Moda', 'Cinzel', design, 630)
  ];

  return {
    version: 2,
    canvas: { color: '#faf6ec', borderColor: accent, borderWidth: 2, borderInset: 30 },
    elements
  };
}

function minimalPreset(design: CertificateDesign): CertificateDocument {
  const accent = design.accentColor;
  const ink = '#111111';
  const labels = resolveLabels(design.labels);

  return {
    version: 2,
    canvas: { color: '#ffffff' },
    elements: [
      ...brandSlots({ x: 90, y: 74, w: 120, h: 48 }, { x: 890, y: 74, w: 120, h: 48 }),
      text({ id: 'org', x: 230, y: 84, w: 640, h: 20, content: '{{orgName}}', family: 'Space Grotesk', size: 12, weight: 500, color: '#666666', tracking: 4.2, uppercase: true }),
      rule('top-rule', 90, 150, 920, '#e0e0e0'),
      text({ id: 'title', x: 90, y: 210, w: 920, h: 96, content: '{{courseName}}', family: 'Space Grotesk', size: 54, weight: 500, color: ink, lineHeight: 1.1, minFontSize: 28, maxLines: 3 }),
      text({ id: 'presented', x: 90, y: 330, w: 920, h: 22, content: labels.presented ?? '', family: 'Space Grotesk', size: 12, color: '#888888', tracking: 3.6, uppercase: true }),
      text({ id: 'recipient', x: 150, y: 360, w: 800, h: 70, content: '{{recipientName}}', family: 'Space Grotesk', size: 44, weight: 700, color: ink, minFontSize: 22, maxLines: 2 }),
      text({ id: 'description', x: 210, y: 448, w: 680, h: 84, content: design.descriptionOverride || '{{courseDescription}}', family: 'Space Grotesk', size: 15, color: '#555555', lineHeight: 1.6, fit: 'clamp', maxLines: 3 }),
      rule('bottom-rule', 90, 600, 920, '#e0e0e0'),
      text({ id: 'issued', x: 90, y: 620, w: 420, h: 20, content: `${labels.issued}: {{date}}`, family: 'DM Mono', size: 11, color: '#666666', align: 'left' }),
      text({ id: 'reference', x: 590, y: 620, w: 420, h: 20, content: `${labels.reference}: {{certificateId}}`, family: 'DM Mono', size: 11, color: '#666666', align: 'right' }),
      ...signaturePair(accent, ink, 'Space Grotesk', 'Space Grotesk', design, 670)
    ]
  };
}

function noirPreset(design: CertificateDesign): CertificateDocument {
  const accent = design.accentColor;
  const ink = '#f5f0e6';
  const labels = resolveLabels(design.labels);

  return {
    version: 2,
    canvas: { color: '#0f0f0f', borderColor: accent, borderWidth: 1, borderInset: 34 },
    elements: [
      ...brandSlots({ x: 80, y: 66, w: 120, h: 50 }, { x: 900, y: 66, w: 120, h: 50 }),
      text({ id: 'org', x: 220, y: 76, w: 660, h: 22, content: '{{orgName}}', family: 'Cinzel', size: 12, color: accent, tracking: 6, uppercase: true }),
      text({ id: 'title', x: 90, y: 156, w: 920, h: 108, content: '{{courseName}}', family: 'Playfair Display', size: 62, color: ink, lineHeight: 1.08, minFontSize: 30, maxLines: 3 }),
      text({ id: 'subtitle', x: 90, y: 274, w: 920, h: 24, content: design.subtitle ?? '', family: 'Cinzel', size: 13, color: accent, tracking: 5.8, uppercase: true }),
      text({ id: 'presented', x: 90, y: 316, w: 920, h: 24, content: labels.presented ?? '', family: 'Playfair Display', size: 17, color: '#b9b0a2', italic: true }),
      text({ id: 'recipient', x: 190, y: 346, w: 720, h: 76, content: '{{recipientName}}', family: 'Playfair Display', size: 54, color: ink, minFontSize: 26, maxLines: 2 }),
      rule('recipient-rule', 300, 428, 500, accent),
      text({ id: 'description', x: 220, y: 448, w: 660, h: 96, content: design.descriptionOverride || '{{courseDescription}}', family: 'Playfair Display', size: 16, color: '#b9b0a2', lineHeight: 1.6, fit: 'clamp', maxLines: 3 }),
      { kind: 'shape', id: 'medal', shape: 'ellipse', x: 500, y: 566, w: 100, h: 100, strokeColor: accent, strokeWidth: 2 },
      text({ id: 'medal-year', x: 500, y: 592, w: 100, h: 26, content: '{{year}}', family: 'Cinzel', size: 17, weight: 600, color: accent }),
      text({ id: 'medal-label', x: 500, y: 618, w: 100, h: 22, content: labels.seal ?? '', family: 'Cinzel', size: 9, color: accent, tracking: 1.4, minFontSize: 7 }),
      ...signaturePair(accent, ink, 'Playfair Display', 'Cinzel', design, 640)
    ]
  };
}

function brutalistPreset(design: CertificateDesign): CertificateDocument {
  const accent = design.accentColor;
  const ink = '#0a0a0a';
  const labels = resolveLabels(design.labels);

  return {
    version: 2,
    canvas: { color: '#f2f0eb' },
    elements: [
      { kind: 'shape', id: 'band', shape: 'rect', x: 0, y: 0, w: 1100, h: 18, fill: accent },
      ...brandSlots({ x: 70, y: 60, w: 130, h: 54 }, { x: 900, y: 60, w: 130, h: 54 }),
      text({ id: 'org', x: 70, y: 130, w: 600, h: 24, content: '{{orgName}}', family: 'JetBrains Mono', size: 13, weight: 500, color: ink, tracking: 2, align: 'left', uppercase: true }),
      text({ id: 'awarded-to', x: 70, y: 190, w: 600, h: 24, content: labels.awardedTo ?? '', family: 'JetBrains Mono', size: 12, color: accent, tracking: 3, align: 'left', uppercase: true }),
      text({ id: 'recipient', x: 70, y: 218, w: 830, h: 96, content: '{{recipientName}}', family: 'Archivo Black', size: 62, color: ink, align: 'left', lineHeight: 1.02, minFontSize: 28, maxLines: 2 }),
      rule('divider', 70, 330, 960, ink, 3),
      text({ id: 'title', x: 70, y: 352, w: 700, h: 92, content: '{{courseName}}', family: 'Archivo Black', size: 34, color: accent, align: 'left', lineHeight: 1.12, minFontSize: 18, maxLines: 3 }),
      text({ id: 'description', x: 70, y: 456, w: 700, h: 90, content: design.descriptionOverride || '{{courseDescription}}', family: 'JetBrains Mono', size: 13, color: '#3a3a3a', align: 'left', lineHeight: 1.6, fit: 'clamp', maxLines: 4 }),
      { kind: 'shape', id: 'stamp', shape: 'rect', x: 810, y: 352, w: 220, h: 130, fill: accent },
      text({ id: 'stamp-label', x: 826, y: 372, w: 188, h: 22, content: labels.seal ?? '', family: 'JetBrains Mono', size: 11, color: '#ffffff', tracking: 2, align: 'left', uppercase: true }),
      text({ id: 'stamp-id', x: 826, y: 400, w: 188, h: 34, content: '{{certificateId}}', family: 'Archivo Black', size: 22, color: '#ffffff', align: 'left', minFontSize: 11 }),
      text({ id: 'stamp-date', x: 826, y: 440, w: 188, h: 22, content: '{{date}}', family: 'JetBrains Mono', size: 11, color: '#ffffff', align: 'left', minFontSize: 8 }),
      ...signaturePair(accent, ink, 'JetBrains Mono', 'JetBrains Mono', design, 640)
    ]
  };
}

function posterPreset(design: CertificateDesign): CertificateDocument {
  const accent = design.accentColor;
  const ink = '#141414';
  const labels = resolveLabels(design.labels);

  return {
    version: 2,
    canvas: { color: '#fdf7f0' },
    elements: [
      { kind: 'shape', id: 'blob-1', shape: 'ellipse', x: -90, y: -110, w: 380, h: 380, fill: `${accent}22` },
      { kind: 'shape', id: 'blob-2', shape: 'ellipse', x: 830, y: 520, w: 340, h: 340, fill: `${accent}1a` },
      ...brandSlots({ x: 80, y: 70, w: 130, h: 54 }, { x: 890, y: 70, w: 130, h: 54 }),
      text({ id: 'org', x: 240, y: 80, w: 620, h: 24, content: '{{orgName}}', family: 'Space Grotesk', size: 13, weight: 700, color: accent, tracking: 4, uppercase: true }),
      text({ id: 'awarded-to', x: 90, y: 190, w: 920, h: 26, content: labels.awardedTo ?? '', family: 'Space Grotesk', size: 14, weight: 500, color: '#7a7a7a', tracking: 4, uppercase: true }),
      text({ id: 'recipient', x: 120, y: 222, w: 860, h: 104, content: '{{recipientName}}', family: 'Archivo Black', size: 68, color: ink, lineHeight: 1.03, minFontSize: 30, maxLines: 2 }),
      text({ id: 'title', x: 150, y: 348, w: 800, h: 84, content: '{{courseName}}', family: 'Space Grotesk', size: 30, weight: 500, color: accent, lineHeight: 1.2, minFontSize: 16, maxLines: 3 }),
      text({ id: 'description', x: 210, y: 444, w: 680, h: 90, content: design.descriptionOverride || '{{courseDescription}}', family: 'Space Grotesk', size: 15, color: '#4a4a4a', lineHeight: 1.6, fit: 'clamp', maxLines: 3 }),
      text({ id: 'issued', x: 90, y: 566, w: 920, h: 24, content: `${labels.issued}: {{date}}`, family: 'Space Grotesk', size: 12, weight: 500, color: '#7a7a7a', tracking: 2, uppercase: true }),
      ...signaturePair(accent, ink, 'Space Grotesk', 'Space Grotesk', design, 646)
    ]
  };
}

/**
 * Partial on purpose: `diploma` has no preset of its own.
 *
 * A preset is a hand-placed copy of a template in fixed coordinates, and the
 * free canvas it seeds is parked behind {@link CANVAS_EDITOR_ENABLED}. Writing
 * one for a layout nobody can open yet would be guesswork nobody could check —
 * so the type says the entry is missing and the fallback below handles it,
 * rather than an alias that quietly hands out somebody else's layout.
 */
const PRESETS: Partial<Record<CertificateTemplateId, (design: CertificateDesign) => CertificateDocument>> = {
  classique: classiquePreset,
  minimal: minimalPreset,
  noir: noirPreset,
  brutalist: brutalistPreset,
  poster: posterPreset
};

/**
 * Seed a canvas from the design a course is already using.
 *
 * Called once, when a teacher switches a course to free layout. From then on
 * the document is the source of truth and this is never consulted again — so
 * editing a preset here does not disturb any course that already switched.
 */
export function buildPresetDocument(design: CertificateDesign): CertificateDocument {
  // `classiquePreset` directly rather than through the map: with the map now
  // partial, its entries are optional too, and the fallback has to be a function
  // that certainly exists.
  const build = PRESETS[design.templateId] ?? classiquePreset;

  return build(design);
}
