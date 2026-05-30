import { redirect } from '@sveltejs/kit';

// Disabled for this deployment (no public org site). Blocks landingpage and
// its nested routes (e.g. /edit) from direct URL access.
export const load = async ({ params }) => {
  redirect(307, `/org/${params.slug}/settings`);
};
