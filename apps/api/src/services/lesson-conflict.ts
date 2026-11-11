/**
 * Un guardado del editor no pisa en silencio lo que otro guardó mientras tanto.
 *
 * ── Lo que pasaba ────────────────────────────────────────────────────────────
 *
 * El editor de una lección manda el texto entero. Si entre que la docente abrió
 * la lección y la guardó alguien más escribió —otra persona del equipo, o el
 * asistente desde otro chat—, su guardado reemplazaba ese cambio sin aviso: ni
 * ella lo había visto, ni quedaba dicho en ningún lado. Medido el 2026-11-10:
 * el párrafo que el asistente de otra cuenta agregó desapareció con el
 * siguiente guardado de la docente, que respondió 201 como si nada.
 *
 * ── Qué se fija ──────────────────────────────────────────────────────────────
 *
 * El editor manda la huella del texto que tenía cargado. Si lo guardado ya es
 * otro texto, el guardado se rechaza (409) y la pantalla le muestra a la
 * docente que la lección cambió, para que decida. Guardar exactamente lo que ya
 * está no es un choque, y un guardado sin huella pisa a propósito.
 */

import { createHash } from 'node:crypto';

/** El código del 409: el panel lo reconoce por acá, no por el texto. */
export const CODIGO_LECCION_CAMBIADA = 'LESSON_CHANGED_ELSEWHERE';

/** La misma cuenta que hace el navegador: SHA-256 del texto en UTF-8, en hexadecimal. */
export function huellaDelContenido(contenido: string | null | undefined): string {
  return createHash('sha256')
    .update(contenido ?? '', 'utf8')
    .digest('hex');
}

export function chocaConOtroGuardado(params: {
  /** La huella que mandó el editor; sin huella no se compara nada. */
  baseHash: string | null | undefined;
  /** Lo que hay guardado ahora. */
  guardado: string | null | undefined;
  /** Lo que se quiere guardar, ya saneado. */
  nuevo: string | null | undefined;
}): boolean {
  if (!params.baseHash) return false;
  if ((params.nuevo ?? '') === (params.guardado ?? '')) return false;

  return huellaDelContenido(params.guardado) !== params.baseHash;
}
