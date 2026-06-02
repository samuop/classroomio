import type { TLocale } from '@cio/db/types';
import i18n from '@sveltekit-i18n/base';
import parser from '@sveltekit-i18n/parser-icu';
import { derived, writable } from 'svelte/store';
import { brandName } from '$lib/utils/branding';

export const config = {
  parser: parser(),
  loaders: [
    {
      locale: 'en',
      key: '',
      loader: async () => (await import('../translations/en.json')).default
    },
    {
      locale: 'hi',
      key: '',
      loader: async () => (await import('../translations/hi.json')).default
    },
    {
      locale: 'fr',
      key: '',
      loader: async () => (await import('../translations/fr.json')).default
    },
    {
      locale: 'pl',
      key: '',
      loader: async () => (await import('../translations/pl.json')).default
    },
    {
      locale: 'pt',
      key: '',
      loader: async () => (await import('../translations/pt.json')).default
    },
    {
      locale: 'de',
      key: '',
      loader: async () => (await import('../translations/de.json')).default
    },
    {
      locale: 'vi',
      key: '',
      loader: async () => (await import('../translations/vi.json')).default
    },
    {
      locale: 'ru',
      key: '',
      loader: async () => (await import('../translations/ru.json')).default
    },
    {
      locale: 'es',
      key: '',
      loader: async () => (await import('../translations/es.json')).default
    },
    {
      locale: 'da',
      key: '',
      loader: async () => (await import('../translations/da.json')).default
    }
  ]
};

const {
  t: rawT,
  loading,
  locales,
  locale,
  initialized,
  translations,
  loadTranslations
} = new i18n(config);

/**
 * Replaces the brand placeholder with the configured brand name. Translations
 * embed `[[brand]]` (a non-ICU token that the parser leaves untouched) instead
 * of a hardcoded brand, so the brand is configurable via PUBLIC_BRAND_NAME.
 */
function brandify(value: unknown): string {
  return typeof value === 'string' ? value.replaceAll('[[brand]]', brandName) : (value as string);
}

type TranslateFn = (key: string, payload?: Record<string, unknown>) => string;

/**
 * Reactive translate store ($t in markup) that injects the brand name. Wraps
 * the i18n store and post-processes every result through brandify(); also
 * exposes `.get()` for use outside components, mirroring the i18n API.
 */
export const t = derived(rawT, ($rawT) => {
  const translate: TranslateFn = (key, payload) => brandify($rawT(key, payload));
  return translate;
}) as ReturnType<typeof derived<typeof rawT, TranslateFn>> & {
  get: TranslateFn;
};

t.get = (key, payload) => brandify(rawT.get(key, payload));

export { loading, locales, locale, initialized, translations, loadTranslations };

export const selectedLocale = writable<string>('es');
export const LOCALE_STORAGE_KEY = 'classroomio_locale';
export const LOCALE_COOKIE_KEY = 'classroomio_locale';

// Translations logs
loading.subscribe(async ($loading) => {
  if ($loading) {
    console.log('Loading translations...');

    await loading.toPromise();
  }
});

export function handleLocaleChange(newLocale: TLocale) {
  if (!newLocale) {
    return;
  }

  locale.set(newLocale);

  selectedLocale.set(newLocale);

  persistLocale(newLocale);
}

export function getPersistedLocale(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const savedLocale = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    if (savedLocale) {
      return savedLocale;
    }
  } catch (error) {
    console.warn('Failed to read saved locale from localStorage', error);
  }

  const cookieMatch = document.cookie.match(new RegExp(`(?:^|; )${LOCALE_COOKIE_KEY}=([^;]*)`));
  return cookieMatch?.[1] ? decodeURIComponent(cookieMatch[1]) : null;
}

function persistLocale(newLocale: TLocale) {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, newLocale);
  } catch (error) {
    console.warn('Failed to save locale to localStorage', error);
  }

  document.cookie = `${LOCALE_COOKIE_KEY}=${encodeURIComponent(newLocale)}; path=/; max-age=31536000; SameSite=Lax`;
}
