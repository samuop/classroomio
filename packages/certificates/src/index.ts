export {
  CERTIFICATE_TEMPLATE_IDS,
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
