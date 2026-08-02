import { config, getPersistedLocale, loadTranslations } from '$lib/utils/functions/translations';

const SUPPORTED_LANGUAGES = config?.loaders?.map((loader) => loader.locale) || [];
// Must match the `fallbackLocale` passed to `new i18n(config, …)` in
// translations.ts. We pre-load it here because @sveltekit-i18n/base does NOT
// auto-load the fallback locale — only the active one is fetched by
// loadTranslations(). Without this, any missing key in the active locale
// would render as a literal instead of falling back to English.
const FALLBACK_LOCALE = 'en';

export const load = async ({ url, data }) => {
  const { pathname } = url;

  const persistedLocale = data?.localeCookie || getPersistedLocale();

  // Default to Spanish for the whole instance: an explicit user choice (cookie)
  // or the user's saved profile locale still wins; otherwise fall back to 'es'
  // rather than the browser language.
  const userLocale = persistedLocale || data?.locals?.profile?.locale || 'es';

  const initLocale = getInitialLocale(userLocale);
  await loadTranslations(initLocale, pathname); // keep this just before the `return`

  // Pre-load the fallback locale so any missing key in the active locale
  // resolves to the English translation instead of rendering the key as a
  // literal. Cheap: ~30KB JSON, parses once per route change.
  if (initLocale !== FALLBACK_LOCALE) {
    await loadTranslations(FALLBACK_LOCALE, pathname);
  }

  return data ?? {};
};

function getInitialLocale(lang: string): string {
  const locale = lang.split('-')[0];

  if (SUPPORTED_LANGUAGES.includes(locale)) return locale;

  return 'es';
}
