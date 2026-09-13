/**
 * «Pedir cambios» al plan tiene que devolver un plan.
 *
 * ── Lo que pasaba (producción, 2026-08-17) ───────────────────────────────────
 *
 * El docente pidió «usemos solo 4 secciones» y el agente contestó «Aquí está el
 * plan ajustado a 4 secciones.» sin llamar a `generate_course_plan`: ninguna
 * tarjeta, ningún plan nuevo, y el botón de aprobar seguía apuntando al viejo.
 * El prompt ya lo prohibía con todas las letras, y le enseñaba la frase que
 * acompaña la llamada; el modelo dijo la frase y se salteó la llamada.
 *
 * El botón sólo enfocaba la caja de texto, así que para el servidor el mensaje
 * siguiente era un chat cualquiera: nada distinguía una revisión del plan.
 *
 * ── Qué hace ─────────────────────────────────────────────────────────────────
 *
 * El pedido de cambios viaja marcado en la metadata del mensaje, y con esa marca
 * el servidor obliga el primer paso a ser `generate_course_plan`. Deja de ser una
 * regla que el modelo puede desobedecer.
 */

interface MensajeConMetadata {
  role?: unknown;
  metadata?: unknown;
}

/** ¿El último mensaje del docente es un pedido de cambios al plan? */
export function pideCambiosAlPlan(mensajes: MensajeConMetadata[]): boolean {
  for (let indice = mensajes.length - 1; indice >= 0; indice -= 1) {
    const mensaje = mensajes[indice];

    if (mensaje?.role !== 'user') continue;

    const plan = (mensaje.metadata as { plan?: { action?: unknown } } | undefined)?.plan;

    return plan?.action === 'request_plan_changes';
  }

  return false;
}
