/**
 * Fechas que el servidor SÍ tiene que escribir.
 *
 * La regla general es que el backend no formatea fechas: manda ISO y el
 * navegador decide cómo mostrarlas, porque es el único que sabe para quién está
 * escribiendo. Pero hay lugares donde no hay navegador después — el cuerpo de un
 * correo, una etiqueta que viaja ya armada — y ahí alguien tiene que elegir un
 * idioma y una zona horaria.
 *
 * Cuando toca elegir, se elige lo mismo que muestra el dashboard: español y hora
 * argentina. Antes cada uno de estos lugares llamaba a
 * `toLocaleString('en-US', { timeZone: 'UTC' })` por su cuenta, así que la fecha
 * de vencimiento de una invitación llegaba en inglés y corrida varias horas
 * respecto de la que el mismo usuario veía en pantalla.
 *
 * Si estás por escribir una fecha en una respuesta que el dashboard va a
 * dibujar, NO uses esto: mandá el ISO y formateá allá con `formatDisplayDate`.
 */
const DISPLAY_LOCALE = 'es-AR';
const DISPLAY_TIMEZONE = 'America/Argentina/Buenos_Aires';

/** "10 ago 2026, 21:33" — para lo que se lee fuera del dashboard. */
export function formatDisplayDateTime(iso: string | number | Date): string {
  const date = new Date(iso);

  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return date.toLocaleString(DISPLAY_LOCALE, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: DISPLAY_TIMEZONE
  });
}
