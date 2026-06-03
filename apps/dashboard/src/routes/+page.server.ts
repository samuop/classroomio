import { redirect } from '@sveltejs/kit';

export const load = async ({ parent }) => {
  const { isOrgSite, org, locals } = await parent();

  // Public org site is disabled for this deployment: there is no open course
  // catalogue. Send visitors straight to the dashboard/LMS (if logged in) or
  // to the login page (the org admin/tutors assign courses; no self-serve).
  if (isOrgSite && org) {
    if (locals?.user) {
      redirect(307, '/home');
    }
    redirect(307, '/login');
  }

  // On the main app root, redirect a logged-in user straight to their org
  // dashboard server-side. This avoids the client-side spinner flash that
  // otherwise shows while setupApp() fetches the account before routing.
  // Default to the first org (mirrors the client fallback in setOrgStore);
  // a student gets corrected to /lms by routeUserToNextPage on the client.
  if (locals?.user && locals.organizations?.length) {
    redirect(307, `/org/${locals.organizations[0].siteName}`);
  }

  return {
    isOrgSite: false as const,
    org: null,
    orgSiteName: '',
    courses: [],
    hasMoreCourses: false
  };
};
