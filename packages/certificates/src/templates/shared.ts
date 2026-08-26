import {
  CERTIFICATE_PAGE_HEIGHT,
  CERTIFICATE_PAGE_WIDTH,
  DEFAULT_BRAND_LOGO_HEIGHT,
  MAX_BRAND_LOGO_HEIGHT,
  MIN_BRAND_LOGO_HEIGHT
} from '../constants';
import type { CertificateBrandPlacement, CertificateDesign, CertificateLabels, CertificateRenderData } from '../types';

export function escapeHtml(input: unknown): string {
  return String(input ?? '').replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}

export function getYear(value: string | undefined | null): string {
  const match = String(value ?? '').match(/\b(19|20|21)\d{2}\b/);
  if (match) return match[0];

  return String(new Date().getFullYear());
}

export function shadeColor(hex: string, percent: number): string {
  const normalized = hex.startsWith('#') ? hex.slice(1) : hex;
  if (normalized.length !== 6) return hex;

  const numeric = parseInt(normalized, 16);
  if (Number.isNaN(numeric)) return hex;

  const offset = Math.round((percent / 100) * 255);
  const clamp = (value: number) => Math.max(0, Math.min(255, value));
  const red = clamp(((numeric >> 16) & 0xff) + offset);
  const green = clamp(((numeric >> 8) & 0xff) + offset);
  const blue = clamp((numeric & 0xff) + offset);
  const next = (red << 16) | (green << 8) | blue;

  return '#' + next.toString(16).padStart(6, '0');
}

export interface TemplateRenderArgs {
  design: CertificateDesign;
  data: CertificateRenderData;
}

/**
 * The marks the certificate is issued under, as HTML.
 *
 * Every template printed the organisation as a line of plain text, and this
 * replaces that line in place — inside the template's own container, inheriting
 * its font, letter-spacing and colour. That is what makes it safe: a course with
 * no logos and no client renders the same markup it always did wrapped in a
 * flex span, so the four layouts that were never meant to change do not.
 *
 * A logo REPLACES the name it belongs to by default — a wordmark already says
 * the name, and printing both is the single most common way a two-brand
 * certificate ends up looking amateur. `brandShowNames` turns that off, because
 * the reasoning does not survive an icon-only mark or one whose lettering is
 * unreadable at certificate scale.
 *
 * `hasLogo` is returned because a couple of templates decorate the org slot —
 * Poster wraps it in a coloured pill — and a logo on a coloured pill looks
 * wrong. They use it to drop the decoration.
 */
export interface RenderedBrands {
  html: string;
  hasLogo: boolean;
  /** True once the client's mark is present, i.e. the certificate is dual-branded. */
  hasClient: boolean;
}

interface BrandInput {
  name: string;
  logoUrl?: string;
  caption?: string;
}

export function renderBrands({
  design,
  data,
  labels
}: TemplateRenderArgs & { labels: Required<CertificateLabels> }): RenderedBrands {
  const client = design.clientBrand ?? {};
  const clientName = client.name?.trim() ?? '';
  const clientLogo = client.logoUrl?.trim() ?? '';
  const hasClient = Boolean(clientName || clientLogo);

  const marks: BrandInput[] = [
    {
      // `data.orgName` is already the override when there is one — applied
      // centrally in `renderCertificate` so it reaches the body text too.
      name: data.orgName,
      logoUrl: data.orgLogoUrl?.trim() || undefined,
      // Captions only mean something when there are two marks to tell apart.
      caption: hasClient ? labels.deliveredBy : ''
    }
  ];

  if (hasClient) {
    marks.push({ name: clientName, logoUrl: clientLogo || undefined, caption: labels.deliveredFor });
  }

  const height = clampLogoHeight(design.brandLogoHeight);

  /**
   * Un logo con el nombre debajo mide casi el doble de alto que el logo solo.
   *
   * La plantilla necesita SABERLO para bajar su tope: `noir` capa el logo a
   * 68px, que le entra justo, y con el nombre abajo el bloque empujaba el
   * centro hasta desbordarlo — el adorno terminaba encima de la fecha. Una
   * clase y no `:has()`: esto lo dibuja el navegador de Cloudflare y no vale la
   * pena apostar a qué versión es.
   */
  const conNombres = marks.some((mark) => mark.logoUrl) && design.brandShowNames ? ' has-names' : '';

  const html =
    `<span class="brands${conNombres}" style="--brand-logo-height:${height}px">` +
    marks
      .map((mark) => {
        const caption = mark.caption?.trim()
          ? `<span class="brand-caption">${escapeHtml(mark.caption.trim())}</span>`
          : '';
        // `alt` carries the name so a certificate whose logo fails to load
        // still says who issued it, which is the one thing it must say.
        const logo = mark.logoUrl
          ? `<img class="brand-logo" src="${escapeHtml(mark.logoUrl)}" alt="${escapeHtml(mark.name)}">`
          : '';
        const name =
          (!mark.logoUrl || design.brandShowNames) && mark.name
            ? `<span class="brand-name">${escapeHtml(mark.name)}</span>`
            : '';

        return `<span class="brand">${caption}${logo}${name}</span>`;
      })
      .join('<span class="brand-divider" aria-hidden="true"></span>') +
    '</span>';

  return {
    html,
    hasLogo: marks.some((mark) => Boolean(mark.logoUrl)),
    hasClient
  };
}

/**
 * Las marcas repartidas en los dos huecos que toda plantilla dibuja.
 *
 * Devuelve las DOS ranuras y no una posición, para que la plantilla escriba
 * `${slots.top}` y `${slots.bottom}` en su markup y el hueco que no se usa
 * quede vacío. Es lo que hace imposible el modo de falla del lienzo libre: no
 * hay coordenada que elegir, hay dos lugares que cada plantilla diseñó sabiendo
 * qué tiene alrededor.
 *
 * `fallback` es dónde las ponía esa plantilla antes de que esto existiera, así
 * que un diseño guardado que no elige nada se sigue viendo exactamente igual.
 */
export function placeBrands(
  brands: RenderedBrands,
  design: CertificateDesign,
  fallback: CertificateBrandPlacement
): { top: string; bottom: string } {
  const donde = design.brandPlacement ?? fallback;

  return {
    top: donde === 'top' ? brands.html : '',
    bottom: donde === 'bottom' ? brands.html : ''
  };
}

/**
 * El hueco de abajo, para las plantillas cuyo pie ya está lleno de firmas.
 *
 * Una banda propia debajo de todo, centrada: no compite con las columnas del
 * pie ni empuja nada, porque el `.cert` tiene alto fijo y esta fila se reserva
 * su espacio como una más del flujo.
 */
export const BRAND_BAND_STYLES = `
  .brand-band {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
  }
  .brand-band:empty { display: none; }
`;

function clampLogoHeight(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_BRAND_LOGO_HEIGHT;

  return Math.round(Math.min(MAX_BRAND_LOGO_HEIGHT, Math.max(MIN_BRAND_LOGO_HEIGHT, value)));
}

/**
 * Shared across all five templates; each one appends its own `max-height` cap
 * for the logo, sized to the slack its layout actually has.
 *
 * Nothing here sets a font: the name inherits whatever the template was already
 * using for the organisation, which is the whole point.
 */
export const BRAND_STYLES = `
  .brands {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 20px;
    vertical-align: middle;
    max-width: 100%;
  }
  .brand {
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 5px;
    min-width: 0;
    text-align: center;
  }
  .brand-caption {
    font-size: 9px;
    line-height: 1;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    opacity: 0.6;
  }
  .brand-logo {
    display: block;
    height: var(--brand-logo-height, ${DEFAULT_BRAND_LOGO_HEIGHT}px);
    width: auto;
    max-width: 230px;
    object-fit: contain;
  }
  .brand-divider {
    width: 1px;
    align-self: stretch;
    min-height: 1.1em;
    background: currentColor;
    opacity: 0.3;
  }
`;

export interface TemplateRenderOutput {
  body: string;
  styles: string;
}

export type TemplateRenderer = (args: TemplateRenderArgs) => TemplateRenderOutput;

export const FONTS_LINK_HREF =
  'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;0,600;0,700;1,400&family=Cinzel:wght@400;500;600;700&family=DM+Mono:wght@400;500&family=Bodoni+Moda:ital,wght@0,400;0,700;1,400&family=Archivo+Black&family=JetBrains+Mono:wght@400;500&family=Playfair+Display:ital,wght@0,400;0,700;0,900;1,400&family=Space+Grotesk:wght@400;500;700&display=swap';

export const BASE_STYLES = `
  /*
    La hoja del PDF. MEDIDO contra Cloudflare, no deducido:
    - sin decir nada          -> 612x792pt (Carta VERTICAL, el default de Chrome)
    - pdfOptions.width/height -> IGNORADO, sigue en 612x792
    - format a4 + landscape   -> 842.9x595.9pt (entra, pero el diseno queda con marco)
    - este @page + preferCSSPageSize -> 824.9x585.1pt = el diseno exacto
    Por eso la medida vive aca, en el CSS, y no en las opciones del PDF: es el
    unico lugar desde donde Cloudflare la escucha. Quien renderiza tiene que
    mandar 'preferCSSPageSize: true' o esto no se aplica.
    En pantalla no hace nada: @page solo existe para medios paginados.
  */
  @page { size: ${CERTIFICATE_PAGE_WIDTH}px ${CERTIFICATE_PAGE_HEIGHT}px; margin: 0; }
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: ${CERTIFICATE_PAGE_WIDTH}px; height: ${CERTIFICATE_PAGE_HEIGHT}px; background: transparent; }
  body { -webkit-font-smoothing: antialiased; }
  .cert { width: ${CERTIFICATE_PAGE_WIDTH}px; height: ${CERTIFICATE_PAGE_HEIGHT}px; position: relative; overflow: hidden; }
`;
