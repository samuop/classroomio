import { redirect } from '@sveltejs/kit';

// Billing is disabled for this deployment (billed out-of-band, not via the app).
export const load = async ({ params }) => {
  redirect(307, `/org/${params.slug}/settings`);
};
