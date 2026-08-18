import { redirect } from '@sveltejs/kit';

// Integrations are disabled for this deployment: the only one on offer is the
// Telegram bot, which is not wired up here. The tab is gone from the sidebar,
// and direct URL access lands back on the profile settings.
export const load = async () => {
  redirect(307, '/lms/settings');
};
