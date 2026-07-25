import { redirect } from '@sveltejs/kit';

// Compliance moved into the unified Seguimiento hub as a tab. Keep the old URL
// working by bouncing it to the new location.
export const load = async ({ params }) => {
  redirect(307, `/org/${params.slug}/seguimiento/cumplimiento`);
};
