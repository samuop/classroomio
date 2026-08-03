import type {
  CertificateDesign,
  CertificateLabels,
  CertificateTemplateId,
  CertificateTemplateMeta
} from './types';

export const ACCENT_COLORS = ['#7a1f1f', '#1e3a8a', '#ff4500', '#d4af37', '#0a0a0a', '#065f46'] as const;

export type AccentColor = (typeof ACCENT_COLORS)[number];

export const DEFAULT_ACCENT_COLOR: string = ACCENT_COLORS[0];

/**
 * Spanish, because this deployment is Spanish-first — the same call already made
 * for the backend's hard-coded UI text. A certificate is a document the student
 * keeps, so it is the last place that should mix languages, and it never passes
 * through the dashboard's i18n layer: it is rendered standalone for PDF export.
 * Every one of these can be overridden per course in the editor.
 */
export const DEFAULT_CERTIFICATE_LABELS: Required<CertificateLabels> = {
  presented: 'se certifica que',
  awardedTo: 'Otorgado a',
  issued: 'Emitido',
  reference: 'Referencia',
  award: 'Distinción',
  distinction: 'Categoría',
  seal: 'Distinción'
};

export function resolveLabels(labels: CertificateLabels | undefined): Required<CertificateLabels> {
  const resolved = { ...DEFAULT_CERTIFICATE_LABELS };

  for (const [key, value] of Object.entries(labels ?? {})) {
    // An empty string is a teacher clearing the field, which is not the same as
    // "use the default" — it means print nothing there. Only absent keys fall
    // back, so a cleared line stays cleared.
    if (typeof value === 'string') {
      resolved[key as keyof CertificateLabels] = value;
    }
  }

  return resolved;
}

export const CERTIFICATE_TEMPLATES: CertificateTemplateMeta[] = [
  {
    id: 'classique',
    label: 'Classique',
    description: 'Vintage engraved with double-rule border and seal.',
    labels: ['presented']
  },
  {
    id: 'brutalist',
    label: 'Brutalist',
    description: 'Raw editorial grid with oversized typography and stamp.',
    labels: ['awardedTo', 'issued', 'award', 'distinction', 'seal']
  },
  {
    id: 'noir',
    label: 'Noir',
    description: 'Dark editorial layout with gilt accents and medal.',
    labels: ['presented', 'seal']
  },
  {
    id: 'poster',
    label: 'Poster',
    description: 'Maximalist editorial with colour blobs and rotated tag.',
    labels: ['awardedTo', 'issued']
  },
  {
    id: 'minimal',
    label: 'Minimal',
    description: 'Refined Swiss layout with thin rules and pure typography.',
    labels: ['issued', 'reference']
  }
];

export function getTemplateLabelKeys(templateId: CertificateTemplateId): CertificateTemplateMeta['labels'] {
  return CERTIFICATE_TEMPLATES.find((template) => template.id === templateId)?.labels ?? [];
}

/**
 * Maps the legacy 6 theme ids onto the new 5 templates.
 * Existing courses keep rendering until they are re-saved.
 */
export const LEGACY_THEME_MAP: Record<string, CertificateTemplateId> = {
  professional: 'classique',
  plain: 'minimal',
  purpleProfessionalBadge: 'noir',
  blueProfessionalBadge: 'noir',
  purpleBadgePattern: 'poster',
  blueBadgePattern: 'poster'
};

export const DEFAULT_CERTIFICATE_DESIGN: CertificateDesign = {
  templateId: 'classique',
  accentColor: DEFAULT_ACCENT_COLOR,
  subtitle: 'Otorgado con distinción',
  signatories: [
    { name: 'Responsable del curso', role: 'Facilitador' },
    { name: 'Dirección', role: 'Director' }
  ],
  idFormat: 'N° {seq}'
};
