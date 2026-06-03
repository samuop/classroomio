import { redirect } from '@sveltejs/kit';

// Domains are disabled for this deployment (no public/custom domains).
export const load = async ({ params }) => {
  redirect(307, `/org/${params.slug}/settings`);
};
