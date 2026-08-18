import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
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
dayjs.extend(utc);
dayjs.extend(timezone);

/**
 * Todo se GUARDA en UTC y se MUESTRA en hora argentina.
 *
 * Fijo, no la zona del navegador: la fecha de un vencimiento o de una
 * inscripción es un hecho de la operación, no del lugar desde donde se mira.
 * Un administrador viajando —o un render del servidor, que corre en UTC— vería
 * el día anterior en cualquier cosa de la madrugada, y no hay forma de notarlo
 * en la pantalla.
 */
export const DISPLAY_TIMEZONE = 'America/Argentina/Buenos_Aires';

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

/**
 * Fecha para mostrar: "17 de ago de 2026", en hora argentina.
 *
 * Devuelve cadena vacía para lo vacío o inválido en lugar de "Invalid Date",
 * que es lo que aparece cuando una fila no tiene fecha y nadie lo previó.
 */
export const formatDisplayDate = (date: string | number | Date | null | undefined): string => {
  if (!date) return '';

  const parsed = dayjs(date);
  if (!parsed.isValid()) return '';

  return parsed.tz(DISPLAY_TIMEZONE).locale(activeDayjsLocale()).format('D [de] MMM [de] YYYY');
};

/** Igual, con la hora: para registros donde el momento del día importa. */
export const formatDisplayDateTime = (date: string | number | Date | null | undefined): string => {
  if (!date) return '';

  const parsed = dayjs(date);
  if (!parsed.isValid()) return '';

  return parsed.tz(DISPLAY_TIMEZONE).locale(activeDayjsLocale()).format('D [de] MMM [de] YYYY, HH:mm');
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
