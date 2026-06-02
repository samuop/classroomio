import { redirect } from '@sveltejs/kit';

// Course analytics is disabled for this deployment. Send visitors to the
// course content instead of rendering the (now unused) analytics page.
export const load = async ({ params }) => {
  redirect(307, `/courses/${params.id}/lessons`);
};
