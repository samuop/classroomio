export {
  CERTIFICATE_TEMPLATE_IDS,
  type CertificateBrand,
  type CertificateDesign,
  type CertificateLabelKey,
  type CertificateLabels,
  type CertificateLogoTone,
  type CertificateRenderData,
  type CertificateRenderResult,
  type CertificateSignatory,
  type CertificateTemplateId,
  type CertificateTemplateMeta
} from './types';

export {
  ACCENT_COLORS,
  CANVAS_EDITOR_ENABLED,
  CERTIFICATE_PAGE_HEIGHT,
  CERTIFICATE_PAGE_WIDTH,
  CERTIFICATE_TEMPLATES,
  DEFAULT_ACCENT_COLOR,
  DEFAULT_BRAND_LOGO_HEIGHT,
  DEFAULT_SIGNATURE_HEIGHT,
  DEFAULT_SIGNATURE_OFFSET,
  MAX_SIGNATURE_HEIGHT,
  MAX_SIGNATURE_OFFSET,
  MIN_SIGNATURE_HEIGHT,
  MIN_SIGNATURE_OFFSET,
  DEFAULT_CERTIFICATE_DESIGN,
  DEFAULT_CERTIFICATE_LABELS,
  LEGACY_THEME_MAP,
  MAX_BRAND_LOGO_HEIGHT,
  MIN_BRAND_LOGO_HEIGHT,
  getTemplateLabelKeys,
  getTemplateSurface,
  resolveLabels,
  type AccentColor
} from './constants';

export { renderCertificate, renderCertificateDocument, resolveTemplateId } from './render';

/**
 * Las tipografias del certificado.
 *
 * Se exporta para que el EDITOR pueda cargar exactamente las mismas: el lienzo
 * editable se dibuja dentro del dashboard, no dentro del iframe de la vista
 * previa, asi que sin esto se editaba con la tipografia de reserva y se imprimia
 * con otra — y el motor de ajuste medía con métricas distintas de las reales.
 */
export { FONTS_LINK_HREF } from './templates/shared';

export { resolveCertificateDesign, sanitizeBrand, sanitizeLabels } from './resolve';

// ─── Plantilla propia (fondo subido + campos ubicables) ──────────────────────

export {
  CERTIFICATE_FIELD_IDS,
  CERTIFICATE_IMAGE_FIELD_IDS,
  isImageField,
  type CertificateFieldId,
  type CertificateFieldPlacement,
  type CertificateLayout
} from './layout/types';

export { DEFAULT_FIELD_PLACEMENTS, resolveFieldPlacement } from './layout/defaults';
export { LAYOUT_CANVAS, buildLayoutDocument } from './layout/build';

// ─── Canvas documents (v2) ───────────────────────────────────────────────────

export {
  BINDING_KEYS,
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  isImageElement,
  isShapeElement,
  isTextElement,
  type BindingKey,
  type CanvasBackground,
  type CertificateDocument,
  type CertificateElement,
  type ElementBase,
  type HorizontalAlign,
  type ImageElement,
  type ImageSource,
  type ShapeElement,
  type ShapeKind,
  type TextElement,
  type TextFit,
  type TextStyle,
  type VerticalAlign
} from './document/types';

export {
  DEFAULT_ADVANCE,
  DEFAULT_MIN_FONT_SIZE,
  FONT_ADVANCE_RATIOS,
  advanceRatioFor,
  estimateTextWidth,
  fitText,
  wrapText,
  type FitResult
} from './document/fit';

export {
  STRESS_BINDING_VALUES,
  buildBindingValues,
  isBindingKey,
  listBindings,
  substituteBindings,
  type BindingValues
} from './document/bindings';

export {
  fontStack,
  imageElementRules,
  renderDocument,
  shapeElementRules,
  textElementRules,
  type DocumentRenderInput,
  type DocumentRenderOutput
} from './document/render';

export { buildPresetDocument } from './document/presets';

export {
  DEFAULT_SNAP_THRESHOLD,
  MIN_ELEMENT_SIZE,
  hitTest,
  keepReachable,
  moveRect,
  resizeRect,
  snapRect,
  type Rect,
  type ResizeHandle,
  type ResizeOptions,
  type SnapGuide,
  type SnapResult
} from './document/geometry';
