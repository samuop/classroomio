import type { CertificateDesign, CertificateLabels, CertificateTemplateId, CertificateTemplateMeta } from './types';

/**
 * El tamano de la hoja del certificado, en pixeles de lienzo.
 *
 * Es apaisado y no es ninguna hoja de oficina. Importa que sea un solo numero y
 * no un literal repetido: el PDF salia en 612x792pt — Carta VERTICAL, el default
 * de Chrome — con el certificado encogido arriba, porque a Cloudflare no se le
 * decia nada.
 * Ahora estas dos constantes mandan en tres lugares a la vez — la caja del
 * documento (BASE_STYLES), la hoja del PDF y el viewport del PNG — asi no puede
 * volver a pasar que el diseno mida una cosa y el archivo exportado otra.
 *
 * (`CANVAS_WIDTH`/`CANVAS_HEIGHT` de `document/types` valen lo mismo y son del
 * editor de lienzo aparcado; viven aparte para no armar un ciclo de imports.
 * Si algun dia cambia esta hoja, hay que cambiarlas tambien.)
 */
export const CERTIFICATE_PAGE_WIDTH = 1100;
export const CERTIFICATE_PAGE_HEIGHT = 780;

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
  completed: 'ha completado satisfactoriamente',
  awardedTo: 'Otorgado a',
  issued: 'Emitido',
  reference: 'Referencia',
  award: 'Distinción',
  distinction: 'Categoría',
  seal: 'Distinción',
  // Empty on purpose. Two logos side by side already read as "delivered by /
  // delivered for", so these print only once a teacher decides they want the
  // words as well.
  deliveredBy: '',
  deliveredFor: ''
};

/**
 * Printed height of a brand logo, in canvas pixels.
 *
 * Deliberately modest: every template grew its header to make room for these,
 * and the layouts below have a fixed 780px to live in. Templates whose header
 * sits in normal flow above an absolutely-positioned footer cap it lower still.
 */
export const DEFAULT_BRAND_LOGO_HEIGHT = 40;
export const MIN_BRAND_LOGO_HEIGHT = 16;
export const MAX_BRAND_LOGO_HEIGHT = 96;

/**
 * La firma escaneada: alto impreso y cuanto se levanta sobre el renglon.
 *
 * El desplazamiento llega a negativo a proposito — abajo de cero la firma cruza
 * la linea, que es lo que hace una firma de verdad sobre un papel.
 */
export const DEFAULT_SIGNATURE_HEIGHT = 42;
export const MIN_SIGNATURE_HEIGHT = 14;
export const MAX_SIGNATURE_HEIGHT = 90;
export const DEFAULT_SIGNATURE_OFFSET = 4;
export const MIN_SIGNATURE_OFFSET = -24;
export const MAX_SIGNATURE_OFFSET = 40;

/**
 * The free-canvas editor, parked.
 *
 * It reached the point of drawing and dragging real elements, but never got
 * close enough to the five fixed templates to be worth shipping: the templates
 * reflow (flex, grid, `clamp()` in `vw`), a canvas is fixed coordinates, and
 * every layout came out visibly different from the one it claimed to be. What
 * the canvas was wanted FOR — two logos on one certificate, and wording a
 * teacher can change — is now in the templates themselves, where it matches by
 * construction.
 *
 * The code is left intact behind this flag rather than deleted: the document
 * model, its deterministic fit engine and its renderer are tested and are the
 * starting point if a canvas is ever built properly. Flipping this back on
 * restores the editor entry point AND `renderCertificate`'s document branch —
 * both read this constant, so the editor and the issued PDF can never disagree
 * about which layout a course uses.
 */
export const CANVAS_EDITOR_ENABLED = false;

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
    labels: ['presented'],
    surface: 'light'
  },
  {
    id: 'diploma',
    label: 'Diploma',
    description: 'Engraved diploma led by the recipient, with both marks at the foot.',
    labels: ['presented', 'completed', 'issued', 'reference'],
    surface: 'light'
  },
  {
    id: 'brutalist',
    label: 'Brutalist',
    description: 'Raw editorial grid with oversized typography and stamp.',
    labels: ['awardedTo', 'issued', 'award', 'distinction', 'seal'],
    surface: 'light'
  },
  {
    id: 'noir',
    label: 'Noir',
    description: 'Dark editorial layout with gilt accents and medal.',
    labels: ['presented', 'seal'],
    surface: 'dark'
  },
  {
    id: 'poster',
    label: 'Poster',
    description: 'Maximalist editorial with colour blobs and rotated tag.',
    labels: ['awardedTo', 'issued'],
    surface: 'light'
  },
  {
    id: 'minimal',
    label: 'Minimal',
    description: 'Refined Swiss layout with thin rules and pure typography.',
    labels: ['issued', 'reference'],
    surface: 'light'
  }
];

/**
 * Sobre que fondo imprime una plantilla.
 *
 * Lo consultan el renderer y el editor. Antes esto era un `id === 'noir'`
 * escrito a mano en el panel de contenido: una plantilla oscura mas y el logo
 * blanco vuelve a desaparecer sin que nada avise.
 */
export function getTemplateSurface(templateId: CertificateTemplateId): 'light' | 'dark' {
  return CERTIFICATE_TEMPLATES.find((template) => template.id === templateId)?.surface ?? 'light';
}

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
