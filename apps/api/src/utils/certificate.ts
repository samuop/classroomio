import {
  CERTIFICATE_PAGE_HEIGHT,
  CERTIFICATE_PAGE_WIDTH,
  renderCertificate,
  resolveCertificateDesign,
  type CertificateDesign,
  type CertificateRenderData
} from '@cio/certificates';

import { renderPdf, renderPng, type RenderPdfOptions, type RenderViewport } from '@api/utils/render';

/**
 * Re-exported, not reimplemented. This used to be ~90 lines here rebuilding the
 * design field by field, and it dropped `labels` on the floor for as long as it
 * existed; the dashboard had its own copy of the same code, which dropped the
 * client's brand. One implementation now lives in `@cio/certificates` so a new
 * design field cannot be remembered in one reader and forgotten in another.
 */
export { resolveCertificateDesign };

export interface CertificateRenderInput {
  design: CertificateDesign;
  data: CertificateRenderData;
}

/**
 * La hoja es el diseno, no A4.
 *
 * Sin esto Chrome imprime en su hoja por defecto — Carta VERTICAL, 612x792pt — y
 * el certificado, que es apaisado, quedaba encogido contra el borde de arriba
 * con media pagina en blanco abajo.
 *
 * La medida NO se declara aca: Cloudflare descartaba `width`/`height` en silencio
 * y con Chromium propio el `@page` es igualmente lo correcto.
 * Vive en el `@page` de BASE_STYLES (packages/certificates) y esta bandera es la
 * que le dice a Chrome que le haga caso. Medido: 824.9x585.1pt, el diseno exacto.
 *
 * `printBackground` no es un detalle: sin el, Chrome descarta fondos al
 * imprimir y las plantillas oscuras (Noir) o de color (Poster) salen en blanco.
 *
 * `pageRanges: '1'` es contra la pagina en blanco de mas: cuando el alto del
 * contenido y el de la hoja coinciden al pixel, cualquier redondeo empuja una
 * franja invisible a una segunda pagina.
 */
const CERTIFICATE_PDF_OPTIONS: RenderPdfOptions = {
  preferCSSPageSize: true,
  printBackground: true,
  margin: { top: '0', right: '0', bottom: '0', left: '0' },
  pageRanges: '1'
};

/** El PNG se saca del mismo lienzo; x2 para que no se vea pixelado impreso. */
const CERTIFICATE_VIEWPORT: RenderViewport = {
  width: CERTIFICATE_PAGE_WIDTH,
  height: CERTIFICATE_PAGE_HEIGHT,
  deviceScaleFactor: 2
};

export async function generateCertificatePdf(input: CertificateRenderInput) {
  const { html, styles } = renderCertificate(input.design, input.data);

  return renderPdf(html, styles, CERTIFICATE_PDF_OPTIONS);
}

export async function generateCertificatePng(input: CertificateRenderInput) {
  const { html, styles } = renderCertificate(input.design, input.data);

  return renderPng(html, styles, CERTIFICATE_VIEWPORT);
}
