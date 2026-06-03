import { redirect } from '@sveltejs/kit';

// The per-course landing page is disabled for this deployment. Send visitors
// to the course content instead of rendering the (now unused) editor.
export const load = async ({ params }) => {
  redirect(307, `/courses/${params.id}/lessons`);
};
