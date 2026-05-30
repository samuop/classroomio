import { redirect } from '@sveltejs/kit';

// Token-auth is an Enterprise (licensed) feature, disabled for this deployment.
export const load = async ({ params }) => {
  redirect(307, `/org/${params.slug}/settings/auth`);
};
