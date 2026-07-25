import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
// Locales for relative-time output. Spanish is the platform default; the others
// match the languages the app ships. dayjs falls back to 'en' for any unmapped.
import 'dayjs/locale/es';
import 'dayjs/locale/fr';
import 'dayjs/locale/pt';
import 'dayjs/locale/de';
import 'dayjs/locale/ru';
import 'dayjs/locale/pl';
import 'dayjs/locale/hi';
import 'dayjs/locale/vi';
import 'dayjs/locale/da';
import { LOCALE_STORAGE_KEY } from '$lib/utils/functions/translations';

dayjs.extend(relativeTime);

// Default to Spanish so server-rendered / first-paint relative times aren't in
// English before the persisted locale is read.
dayjs.locale('es');

/** Reads the persisted UI locale (browser only) so dayjs matches the language. */
function activeDayjsLocale(): string {
  if (typeof localStorage === 'undefined') return 'es';
  return localStorage.getItem(LOCALE_STORAGE_KEY) || 'es';
}

/**
 * Localized "hace un día" / "a day ago" style relative time. Uses dayjs's own
 * localized `fromNow()` (no hardcoded " ago"), keyed off the active UI locale.
 */
export const calDateDiff = (date: string | number | Date): string => {
  return dayjs(date).locale(activeDayjsLocale()).fromNow();
};

export const getGreeting = () => {
  const date = new Date();
  const hours = date.getHours();
  return hours < 12
    ? 'dashboard.morning_heading'
    : hours < 18
      ? 'dashboard.afternoon_heading'
      : 'dashboard.evening_heading';
};
