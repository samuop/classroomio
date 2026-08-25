import type { MetaTagsProps } from 'svelte-meta-tags';
import type { OrgSiteInfo } from '$features/app/layout-setup';
import { PUBLIC_IS_SELFHOSTED } from '$env/static/public';
import { env } from '$env/dynamic/public';
import { brandName } from '$lib/utils/branding';

const isSelfHosted = PUBLIC_IS_SELFHOSTED === 'true';

const DEFAULT_TITLE = `${brandName} | Learning Platform`;
const DEFAULT_DESCRIPTION =
  'A flexible, user-friendly platform for creating, managing, and delivering courses for companies and training organisations';
/**
 * Sin imagen por defecto, a propósito.
 *
 * Acá había `/logo-512.png`, que es el isotipo de ClassroomIO: cada link que se
 * compartía sin imagen propia previsualizaba con la marca del proyecto
 * original — incluso una consultora mandándole un curso a su cliente. Antes que
 * prestar una marca ajena, no se manda imagen y la vista previa queda sólo con
 * título y descripción.
 */
const NO_OG_IMAGE = null;

/**
 * The picture that shows when a link to this platform is shared.
 *
 * The organisation's own image is tried whatever the tenancy mode. It used to be
 * gated on `isSelfHosted`, which reads as a branding switch but is really the
 * multi-tenant switch — so this deployment (multi-tenant, hence not "self
 * hosted") sent the bundled upstream logo as the preview for every shared link,
 * including a consultancy sharing a course with its own client.
 */
function resolveOgImageUrl(url: URL, orgSiteInfo: OrgSiteInfo): string | null {
  const envUrl = env.PUBLIC_OG_IMAGE_URL?.trim();
  if (envUrl) return envUrl;

  const org = orgSiteInfo.org;
  const orgImage =
    org?.avatarUrl ||
    org?.landingpage?.header?.banner?.image ||
    (org as { customization?: { dashboard?: { bannerImage?: string } } } | undefined)?.customization?.dashboard
      ?.bannerImage;

  if (orgImage) {
    try {
      return new URL(orgImage, url.origin).href;
    } catch {
      // fall through to the bundled default
    }
  }

  return NO_OG_IMAGE;
}

export function getBaseMetaTags(url: URL, orgSiteInfo: OrgSiteInfo): MetaTagsProps {
  const title =
    env.PUBLIC_APP_TITLE?.trim() ||
    (isSelfHosted && orgSiteInfo.org?.name ? `${orgSiteInfo.org.name} | Learning Platform` : DEFAULT_TITLE);

  const description = env.PUBLIC_APP_DESCRIPTION?.trim() || DEFAULT_DESCRIPTION;

  const siteName =
    env.PUBLIC_APP_TITLE?.trim() ||
    (isSelfHosted && orgSiteInfo.org?.name ? orgSiteInfo.org.name : null) ||
    brandName;

  const ogImageUrl = resolveOgImageUrl(url, orgSiteInfo);

  return Object.freeze({
    title,
    description,
    canonical: new URL(url.pathname, url.origin).href,
    openGraph: {
      type: 'website',
      url: new URL(url.pathname, url.origin).href,
      locale: 'en_US',
      title,
      description,
      siteName,
      // Sin imagen no va la clave: `images: [{ url: null }]` emitiría una
      // etiqueta og:image vacía, que para un scraper es peor que la ausencia.
      ...(ogImageUrl
        ? {
            images: [
              {
                url: ogImageUrl,
                alt: `${siteName} OG Image`,
                width: 1920,
                height: 1080,
                secureUrl: ogImageUrl,
                type: 'image/png'
              }
            ]
          }
        : {})
    },
    twitter: {
      cardType: ogImageUrl ? ('summary_large_image' as const) : ('summary' as const),
      title,
      description,
      ...(ogImageUrl ? { image: ogImageUrl, imageAlt: `${siteName} OG Image` } : {})
    }
  });
}
