import { CLOUDFLARE } from '@api/constants';

/**
 * Whether this deployment can render certificates at all.
 *
 * Without these two values the call goes out as
 * `/accounts/undefined/browser-rendering/pdf` with `Bearer undefined`, and
 * Cloudflare answers 404 — which reads like a broken feature rather than an
 * unconfigured one. The route uses this to say which it is, because the person
 * who sees the message is usually the person who can fix it.
 */
export function isCertificateRenderConfigured(): boolean {
  return Boolean(CLOUDFLARE.CONFIGS.ACCOUNT_ID && CLOUDFLARE.CONFIGS.RENDERING_API_KEY);
}

export const CERTIFICATE_RENDER_UNCONFIGURED =
  'Certificate export is not configured: CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_RENDERING_API_KEY must be set on the API.';

/**
 * A failed render must fail, not become a file.
 *
 * Neither of these functions checked the response, so any error — a 404 from an
 * unconfigured account id, an expired key, a Cloudflare outage — came back as
 * `Buffer.from(<the JSON error body>)` and was served with a 200 and a
 * `application/pdf` header. The teacher gets a file that will not open, with
 * nothing anywhere saying why, and the same path issues certificates to
 * students.
 *
 * The body is included in the error because Cloudflare says something useful in
 * it, and truncated because it is not always JSON.
 */
async function readRenderedBuffer(response: Response, kind: 'PDF' | 'PNG'): Promise<Buffer> {
  if (!response.ok) {
    const detail = await response.text().catch(() => '');

    throw new Error(
      `Cloudflare Browser Rendering returned ${response.status} for the ${kind}. ${detail.slice(0, 300)}`.trim()
    );
  }

  const buffer = Buffer.from(await response.arrayBuffer());

  // A 200 with nothing in it is the other way this silently produces a file
  // that will not open.
  if (buffer.byteLength === 0) {
    throw new Error(`Cloudflare Browser Rendering returned an empty ${kind}.`);
  }

  return buffer;
}

/**
 * Puppeteer's PDF options, forwarded verbatim by Cloudflare.
 *
 * Optional because the two callers want opposite things: a certificate is one
 * fixed landscape sheet, and a course download is an ordinary flowing document
 * that should keep Chrome's default paper. Leaving this out is what a normal
 * document looks like.
 */
export interface CloudflarePdfOptions {
  /**
   * Obedece el `@page` del CSS. Es la UNICA forma de fijar la hoja aca:
   * `width`/`height` existen en Puppeteer pero Cloudflare los descarta sin
   * avisar — medido, el PDF volvia en 612x792pt igual — asi que ni figuran en
   * este tipo, para que nadie los use esperando que hagan algo.
   */
  preferCSSPageSize?: boolean;
  format?: string;
  landscape?: boolean;
  printBackground?: boolean;
  margin?: { top: string; right: string; bottom: string; left: string };
  pageRanges?: string;
}

export interface CloudflareViewport {
  width: number;
  height: number;
  deviceScaleFactor?: number;
}

export const getCloudflarePdfBuffer = async (html: string, styles?: string, pdfOptions?: CloudflarePdfOptions) => {
  console.log('Generating PDF with Cloudflare API...');
  try {
    const pdfResponse = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE.CONFIGS.ACCOUNT_ID}/browser-rendering/pdf`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${CLOUDFLARE.CONFIGS.RENDERING_API_KEY}`
        },
        body: JSON.stringify({
          html: html,
          addStyleTag: [{ content: `${styles}` }],
          ...(pdfOptions ? { pdfOptions } : {})
        })
      }
    );

    console.log('PDF response status:', pdfResponse.status);

    return readRenderedBuffer(pdfResponse, 'PDF');
  } catch (error) {
    console.error('Error generating PDF:', error);
    throw new Error(error instanceof Error ? error.message : 'Failed to generate PDF');
  }
};

/**
 * Renders HTML to a PNG via Cloudflare Browser Rendering's `/screenshot` endpoint.
 * The viewport comes from the caller so the image cannot drift from the page
 * size the same design is printed at.
 */
export const getCloudflarePngBuffer = async (html: string, styles?: string, viewport?: CloudflareViewport) => {
  console.log('Generating PNG with Cloudflare API...');
  try {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE.CONFIGS.ACCOUNT_ID}/browser-rendering/screenshot`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${CLOUDFLARE.CONFIGS.RENDERING_API_KEY}`
        },
        body: JSON.stringify({
          html,
          addStyleTag: styles ? [{ content: styles }] : undefined,
          viewport: { deviceScaleFactor: 2, ...viewport },
          screenshotOptions: { type: 'png', omitBackground: false, fullPage: false }
        })
      }
    );

    console.log('PNG response status:', response.status);

    return readRenderedBuffer(response, 'PNG');
  } catch (error) {
    console.error('Error generating PNG:', error);
    throw new Error(error instanceof Error ? error.message : 'Failed to generate PNG');
  }
};
