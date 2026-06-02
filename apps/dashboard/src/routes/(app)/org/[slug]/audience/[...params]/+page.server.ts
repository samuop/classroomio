import { redirect } from '@sveltejs/kit';

// The audience member-detail view was consolidated into the unified learner
// profile (org/[slug]/students/[profileId]). Redirect any old links there so
// there is a single student profile across the app.
export const load = async ({ params }) => {
  const userId = params.params?.split('/')[0];

  if (userId) {
    redirect(307, `/org/${params.slug}/students/${userId}`);
  }

  redirect(307, `/org/${params.slug}/audience`);
};
