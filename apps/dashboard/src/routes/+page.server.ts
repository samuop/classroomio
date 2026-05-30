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

  return {
    isOrgSite: false as const,
    org: null,
    orgSiteName: '',
    courses: [],
    hasMoreCourses: false
  };
};
