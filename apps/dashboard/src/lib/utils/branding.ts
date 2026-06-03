import { env } from '$env/dynamic/public';

/**
 * Central branding values, overridable per deployment via PUBLIC_* env vars so
 * the brand can change without recompiling. Defaults target this deployment
 * (Tensor Tech), a modified fork of ClassroomIO distributed under AGPL-3.0.
 */

/** Display name shown in the sidebar, titles, attribution, etc. */
export const brandName = env.PUBLIC_BRAND_NAME?.trim() || 'Tensor Tech';

/** Optional public domain for the brand (e.g. used in links). Empty if unset. */
export const brandDomain = env.PUBLIC_BRAND_DOMAIN?.trim() || '';

/** Support/contact email surfaced on error and attribution pages. */
export const supportEmail = env.PUBLIC_SUPPORT_EMAIL?.trim() || '';

/**
 * URL to the source code of this fork. AGPL-3.0 requires offering source to
 * users of the network service, so this is surfaced on the attribution page.
 */
export const sourceCodeUrl = env.PUBLIC_SOURCE_CODE_URL?.trim() || 'https://github.com/samuop/classroomio';
