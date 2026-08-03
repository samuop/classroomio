export {
  CERTIFICATE_TEMPLATE_IDS,
  type CertificateClientBrand,
  type CertificateDesign,
  type CertificateLabelKey,
  type CertificateLabels,
  type CertificateRenderData,
  type CertificateRenderResult,
  type CertificateSignatory,
  type CertificateTemplateId,
  type CertificateTemplateMeta
} from './types';

export {
  ACCENT_COLORS,
  CERTIFICATE_TEMPLATES,
  DEFAULT_ACCENT_COLOR,
  DEFAULT_CERTIFICATE_DESIGN,
  DEFAULT_CERTIFICATE_LABELS,
  LEGACY_THEME_MAP,
  getTemplateLabelKeys,
  resolveLabels,
  type AccentColor
} from './constants';

export { renderCertificate, renderCertificateDocument, resolveTemplateId } from './render';

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
  renderDocument,
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
