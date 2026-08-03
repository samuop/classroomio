import {
  renderCertificate,
  resolveCertificateDesign,
  type CertificateDesign,
  type CertificateRenderData
} from '@cio/certificates';

import { getCloudflarePdfBuffer, getCloudflarePngBuffer } from '@api/utils/cloudflare';

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

export async function generateCertificatePdf(input: CertificateRenderInput) {
  const { html, styles } = renderCertificate(input.design, input.data);

  return getCloudflarePdfBuffer(html, styles);
}

export async function generateCertificatePng(input: CertificateRenderInput) {
  const { html, styles } = renderCertificate(input.design, input.data);

  return getCloudflarePngBuffer(html, styles);
}
