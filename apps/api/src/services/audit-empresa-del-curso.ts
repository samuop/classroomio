/**
 * En qué empresa se registra lo que se hace sobre un curso.
 *
 * ── Lo que pasaba ────────────────────────────────────────────────────────────
 *
 * La auditoría tomaba la empresa del encabezado `cio-org-id`: la que el panel
 * tiene activa. Las rutas de un curso autorizan por el equipo del curso y no
 * miran ese encabezado, así que una edición quedaba registrada en la empresa
 * que estuviera activa en ese momento, fuera o no la del curso. Medido el
 * 2026-11-11: 9 de 16 ediciones de prueba quedaron en una empresa sin relación
 * con el curso. Quien después busca «qué pasó con este curso» en la auditoría
 * de su empresa no las encuentra, y las ve otra empresa que no tiene por qué.
 *
 * ── Qué se fija ──────────────────────────────────────────────────────────────
 *
 * Lo que pasa por `/course/<id>/…` se registra en la empresa DEL CURSO. Si no
 * se puede averiguar (el curso ya no existe, la base no contesta), vale lo de
 * antes: la auditoría nunca rompe ni demora el pedido por esto.
 */

import { getCourseOrganizationId } from '@cio/db/queries/tag';

const RUTA_DE_CURSO =
  /^\/course\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/|$)/i;

/** El curso que nombra la ruta, si nombra uno (`/course/import` no nombra ninguno). */
export function cursoDeLaRuta(path: string): string | null {
  return RUTA_DE_CURSO.exec(path)?.[1] ?? null;
}

/** La empresa dueña del curso que nombra la ruta; `null` si no hay curso o no se pudo saber. */
export async function empresaDelCursoDeLaRuta(path: string): Promise<string | null> {
  const courseId = cursoDeLaRuta(path);

  if (!courseId) return null;

  try {
    return await getCourseOrganizationId(courseId);
  } catch {
    return null;
  }
}
