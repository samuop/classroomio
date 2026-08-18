import { redirect } from '@sveltejs/kit';

// Integrations are disabled for this deployment (see the LMS counterpart). This
// route was already absent from the settings menu; the redirect closes the URL.
export const load = async ({ params }) => {
  redirect(307, `/org/${params.slug}/settings`);
};
