import { redirect } from '@sveltejs/kit';

/**
 * Public course "storefront" is disabled for now (org landing page, public course
 * landing, and public lessons). We are focusing on the platform's core LMS features
 * and will revisit the public-facing site later.
 *
 * Everything under (org-site) is gated here so there is a single choke point:
 *   - Logged-in users  → their dashboard (/home)
 *   - Anonymous users  → /login
 *
 * Exception: the enroll page reached with an `invite_token` must stay open, because
 * that is how invited students accept an invitation before they have an account.
 *
 * To re-enable the public site later, delete this file.
 */
export const load = async ({ parent, url, locals }) => {
  const { isOrgSite, org } = await parent();

  // Only guard actual org-site (public storefront) traffic. Non-org-site requests
  // fall through to their own routing untouched.
  if (!isOrgSite || !org) {
    return {};
  }

  // Allow the invitation-acceptance flow: /course/<slug>/enroll?invite_token=...
  const isEnrollPath = /^\/course\/[^/]+\/enroll\/?$/.test(url.pathname);
  const hasInviteToken = !!url.searchParams.get('invite_token');
  if (isEnrollPath && hasInviteToken) {
    return {};
  }

  throw redirect(307, locals?.user ? '/home' : '/login');
};
