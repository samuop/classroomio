import { redirect } from '@sveltejs/kit';

// Zapier is disabled for this deployment: the feature is an unimplemented
// "coming soon" placeholder, so direct URL access is bounced to the org home.
export const load = async ({ params }) => {
  redirect(307, `/org/${params.slug}`);
};
