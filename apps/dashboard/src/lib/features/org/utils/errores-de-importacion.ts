import { ErrorCodes } from '@cio/utils/constants';
import { t } from '$lib/utils/functions/translations';

/** Cuántos correos culpables se nombran; el resto se cuenta. */
const CORREOS_A_NOMBRAR = 8;

function nombrarCorreos(correos: string[]): string {
  const nombrados = correos.slice(0, CORREOS_A_NOMBRAR).join(', ');
  const resto = correos.length - CORREOS_A_NOMBRAR;

  return resto > 0 ? `${nombrados} ${t.get('audience.import.error_more', { count: resto })}` : nombrados;
}

/**
 * Lo que la docente lee cuando una importación de alumnos falla.
 *
 * Antes los rechazos con `field` quedaban guardados en `orgApi.errors`, que
 * ninguna pantalla mostraba: la lista tenía un correo mal escrito, no se invitaba
 * a nadie y no aparecía nada. Ahora cada falla dice dos cosas: qué pasó, y si se
 * invitó a alguien —que es lo que decide si se puede volver a mandar la lista.
 *
 * - Un rechazo de la API (4xx, llega como objeto) pasa ANTES de escribir nada.
 * - Un texto suelto es tiempo agotado, corte de red o 5xx: la importación pudo
 *   haber corrido igual del lado del servidor, y volver a mandarla a ciegas
 *   duplicaría los correos.
 */
export function mensajeDeErrorDeImportacion(resultado: unknown): string {
  if (typeof resultado === 'string') {
    return t.get('audience.import.error_unknown_outcome');
  }

  if (resultado && typeof resultado === 'object') {
    const { code, details } = resultado as { code?: unknown; details?: { emails?: unknown } };
    const correos = Array.isArray(details?.emails)
      ? details.emails.filter((correo): correo is string => typeof correo === 'string')
      : [];

    if (code === ErrorCodes.AUDIENCE_INVALID_EMAILS) {
      return t.get('audience.import.error_invalid_emails', { emails: nombrarCorreos(correos) });
    }

    if (code === ErrorCodes.AUDIENCE_STAFF_EMAILS) {
      return t.get('audience.import.error_staff_emails', { emails: nombrarCorreos(correos) });
    }
  }

  return t.get('audience.import.error_rejected');
}
