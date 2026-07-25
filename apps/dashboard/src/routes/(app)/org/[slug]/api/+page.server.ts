import { redirect } from '@sveltejs/kit';

// Automation (API keys) is hidden for now — the focus is the platform's core
// features. Direct URL access is bounced to the org home. Re-enable by restoring
// the data loader below and uncommenting the API menu item in org-navigation.ts.
export const load = async ({ params }) => {
  redirect(307, `/org/${params.slug}`);
};
