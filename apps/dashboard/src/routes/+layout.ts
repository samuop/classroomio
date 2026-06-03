import { config, getPersistedLocale, loadTranslations } from '$lib/utils/functions/translations';

const SUPPORTED_LANGUAGES = config?.loaders?.map((loader) => loader.locale) || [];

export const load = async ({ url, data }) => {
  const { pathname } = url;

  const persistedLocale = data?.localeCookie || getPersistedLocale();

  // Default to Spanish for the whole instance: an explicit user choice (cookie)
  // or the user's saved profile locale still wins; otherwise fall back to 'es'
  // rather than the browser language.
  const userLocale = persistedLocale || data?.locals?.profile?.locale || 'es';

  const initLocale = getInitialLocale(userLocale);
  await loadTranslations(initLocale, pathname); // keep this just before the `return`

  return data ?? {};
};

function getInitialLocale(lang: string): string {
  const locale = lang.split('-')[0];

  if (SUPPORTED_LANGUAGES.includes(locale)) return locale;

  return 'es';
}
