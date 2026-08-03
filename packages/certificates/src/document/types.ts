/**
 * The canvas document — a certificate described as positioned elements rather
 * than as one of five fixed layouts.
 *
 * Coordinates are in canvas units, and the canvas is 1100x780, which is not a
 * new choice: `BASE_STYLES` already pins the certificate body to that size and
 * the PNG export viewport matches it. So a document's numbers mean the same
 * thing in the editor, in the preview iframe, and in the file Cloudflare
 * renders — no scaling step to get wrong.
 */

/** The fixed canvas every certificate is composed on. */
export const CANVAS_WIDTH = 1100;
export const CANVAS_HEIGHT = 780;

/** Fields a text element can interpolate. See `substituteBindings`. */
export const BINDING_KEYS = [
  'recipientName',
  'courseName',
  'courseDescription',
  'orgName',
  'clientName',
  'date',
  'certificateId'
] as const;

export type BindingKey = (typeof BINDING_KEYS)[number];

export type HorizontalAlign = 'left' | 'center' | 'right';
export type VerticalAlign = 'top' | 'middle' | 'bottom';

/**
 * What a text box does when its content does not fit.
 *
 * This is the contract that makes free positioning safe. A certificate holds
 * data of wildly variable length — "Ana Ruiz" and "María de los Ángeles
 * Fernández Etchegaray" go in the same box — so an element that only knows
 * where it sits will eventually be laid over its neighbour. That is not
 * hypothetical: it is the seal-over-description bug that shipped in
 * `classique`, where the footer was positioned absolutely and nothing reserved
 * its space.
 *
 * - `shrink`  — reduce the font size until it fits, never below `minFontSize`.
 *               The right default for names and titles.
 * - `clamp`   — keep the size, cut at `maxLines` with an ellipsis. Right for
 *               descriptions, where shrinking to 9pt would be worse than
 *               trailing off.
 * - `overflow`— leave it alone. Escape hatch for a designer who knows the
 *               content is fixed; the editor warns when it actually overflows.
 */
export type TextFit = 'shrink' | 'clamp' | 'overflow';

export interface TextStyle {
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  /** Multiplier, not px — so a shrunk font keeps its proportions. */
  lineHeight: number;
  letterSpacing: number;
  color: string;
  italic?: boolean;
  uppercase?: boolean;
  align: HorizontalAlign;
  verticalAlign: VerticalAlign;
}

export interface ElementBase {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Degrees, clockwise, around the element's centre. */
  rotation?: number;
  opacity?: number;
  /** Locked elements are skipped by editor hit-testing; they still render. */
  locked?: boolean;
}

export interface TextElement extends ElementBase {
  kind: 'text';
  /** Literal text with `{{binding}}` tokens, e.g. "Otorgado a {{recipientName}}". */
  content: string;
  style: TextStyle;
  fit: TextFit;
  /** Floor for `shrink`. Below this a certificate stops being readable. */
  minFontSize?: number;
  /** Ceiling for `clamp`. */
  maxLines?: number;
}

/**
 * Where an image comes from.
 *
 * `orgLogo` and `clientLogo` are resolved at render time from the render data
 * rather than stored as URLs, so changing the organisation's logo updates every
 * certificate instead of freezing whatever URL was current the day the design
 * was saved.
 */
export type ImageSource =
  | { kind: 'orgLogo' }
  | { kind: 'clientLogo' }
  | { kind: 'upload'; url: string };

export interface ImageElement extends ElementBase {
  kind: 'image';
  source: ImageSource;
  /** `contain` never crops — the safe default for a logo. */
  fit: 'contain' | 'cover';
  radius?: number;
  /** Rendered when the source resolves to nothing (no client logo set, say). */
  hideWhenEmpty?: boolean;
}

export type ShapeKind = 'rect' | 'line' | 'ellipse';

export interface ShapeElement extends ElementBase {
  kind: 'shape';
  shape: ShapeKind;
  fill?: string;
  strokeColor?: string;
  strokeWidth?: number;
  radius?: number;
}

export type CertificateElement = TextElement | ImageElement | ShapeElement;

export interface CanvasBackground {
  color: string;
  /** Optional full-bleed image behind everything (a paper texture, a border art). */
  imageUrl?: string;
  borderColor?: string;
  borderWidth?: number;
  borderInset?: number;
}

export interface CertificateDocument {
  version: 2;
  canvas: CanvasBackground;
  /** Painted in array order, so the last element is on top. */
  elements: CertificateElement[];
}

export function isTextElement(element: CertificateElement): element is TextElement {
  return element.kind === 'text';
}

export function isImageElement(element: CertificateElement): element is ImageElement {
  return element.kind === 'image';
}

export function isShapeElement(element: CertificateElement): element is ShapeElement {
  return element.kind === 'shape';
}
