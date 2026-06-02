import { PUBLIC_IS_SELFHOSTED } from '$env/static/public';
import { initPosthog, type PosthogBootstrapUser } from '$lib/utils/services/posthog';
import { initUmami } from '$lib/utils/services/umami';
import { initUserJot } from '$lib/utils/services/userjot';
import { licenseApi } from '$features/license/api/license.svelte';

let isInitialized = false;

export function setupAnalytics(user?: PosthogBootstrapUser) {
  if (isInitialized) return;
  isInitialized = true;

  initPosthog(user);
  initUmami();
  initUserJot();
}

/** Checks if this is cloud deployment and initializes analytics */
export function setupCloudAnalytics(user?: PosthogBootstrapUser) {
  if (PUBLIC_IS_SELFHOSTED !== 'true') {
    setupAnalytics(user);
  }
}

export function setupAnalyticsBasedOnLicense(user?: PosthogBootstrapUser) {
  // Self-hosted deployments never load third-party tracking (PostHog/Umami/UserJot).
  if (PUBLIC_IS_SELFHOSTED === 'true') {
    return;
  }

  if (licenseApi.hasAccess('no-tracking')) {
    return;
  }

  setupAnalytics(user);
}
