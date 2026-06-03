import { redirect } from '@sveltejs/kit';

// Org analytics is disabled for this deployment. Send visitors to the org
// dashboard instead of rendering the (now unused) analytics page.
export const load = async ({ params }) => {
  redirect(307, `/org/${params.slug}/dash`);
};
