import { CANVAS_EDITOR_ENABLED, LEGACY_THEME_MAP } from './constants';
import type { CertificateDesign, CertificateRenderData, CertificateRenderResult, CertificateTemplateId } from './types';
import { CERTIFICATE_TEMPLATE_IDS } from './types';
import { renderBrutalist } from './templates/brutalist';
import { renderClassique } from './templates/classique';
import { renderMinimal } from './templates/minimal';
import { renderNoir } from './templates/noir';
import { renderPoster } from './templates/poster';
import { BASE_STYLES, FONTS_LINK_HREF, type TemplateRenderer } from './templates/shared';
import { renderDocument } from './document/render';

const RENDERERS: Record<CertificateTemplateId, TemplateRenderer> = {
  classique: renderClassique,
  brutalist: renderBrutalist,
  noir: renderNoir,
  poster: renderPoster,
  minimal: renderMinimal
};

export function resolveTemplateId(value: string | undefined | null): CertificateTemplateId {
  if (!value) return 'classique';
  if (CERTIFICATE_TEMPLATE_IDS.includes(value as CertificateTemplateId)) {
    return value as CertificateTemplateId;
  }
  if (value in LEGACY_THEME_MAP) {
    return LEGACY_THEME_MAP[value]!;
  }

  return 'classique';
}

/**
 * The design's own overrides, folded into the render data before any template
 * sees it.
 *
 * Done once, here, rather than in five templates: the title and the issuing
 * organisation appear in more than one place in some layouts — Brutalist prints
 * the course name in its metadata row as well as its title block — and an
 * override applied per-slot would have left the same certificate saying two
 * different things.
 */
function applyOverrides(design: CertificateDesign, data: CertificateRenderData): CertificateRenderData {
  return {
    ...data,
    courseName: design.titleOverride?.trim() || data.courseName,
    orgName: design.orgBrand?.name?.trim() || data.orgName,
    // The workspace avatar is a square bitmap sized for a nav bar. When a course
    // supplies a proper lock-up it wins, and it is usually a transparent SVG.
    orgLogoUrl: design.orgBrand?.logoUrl?.trim() || data.orgLogoUrl
  };
}

/**
 * Render a design, whichever generation it belongs to.
 *
 * A design carrying a `document` is a canvas layout and goes through
 * `renderDocument`. Everything else takes the original path, and that path is
 * left byte-for-byte as it was on purpose: thousands of certificates have
 * already been issued from those five renderers, and a course that never opens
 * the new editor must keep producing exactly the file it produced yesterday.
 * Branching rather than migrating is what makes that guarantee cheap to hold.
 *
 * The canvas branch is behind `CANVAS_EDITOR_ENABLED`, and the editor reads the
 * same constant. That is what keeps the two honest: with the canvas parked, a
 * course that still has a stored layout renders through its template — which is
 * what the editor now shows — instead of issuing a document nobody can open.
 */
export function renderCertificate(
  design: CertificateDesign,
  renderData: CertificateRenderData
): CertificateRenderResult {
  const data = applyOverrides(design, renderData);

  if (CANVAS_EDITOR_ENABLED && design.document) {
    const rendered = renderDocument({
      document: design.document,
      data,
      clientBrand: design.clientBrand
    });

    return wrapDocument(rendered.body, rendered.styles);
  }

  const templateId = resolveTemplateId(design.templateId);
  const renderer = RENDERERS[templateId];
  const { body, styles } = renderer({ design: { ...design, templateId }, data });

  return wrapDocument(body, styles);
}

function wrapDocument(body: string, styles: string): CertificateRenderResult {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=1100,initial-scale=1.0">
  <title>Certificate</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="${FONTS_LINK_HREF}">
</head>
<body>
${body}
</body>
</html>`;

  const fullStyles = BASE_STYLES + '\n' + styles;

  return { html, styles: fullStyles };
}

/**
 * Returns a single-document HTML string that already includes the styles inline.
 * Useful for iframe `srcdoc` and `<iframe>`-style previews where a separate
 * `addStyleTag` is not available.
 */
export function renderCertificateDocument(design: CertificateDesign, data: CertificateRenderData): string {
  const { html, styles } = renderCertificate(design, data);

  return html.replace('</head>', `<style>${styles}</style></head>`);
}
