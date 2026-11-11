/**
 * Si al pasar de edición a vista hay que guardar la lección.
 *
 * ── Lo que pasaba ────────────────────────────────────────────────────────────
 *
 * Se guardaba siempre. «Dejar de editar sin guardar» guardaba igual, y una
 * lección abierta sólo para mirar se reescribía con lo que esa pantalla tenía
 * cargado: medido el 2026-11-10, eso borró el cambio que otra sesión había
 * guardado mientras tanto. Y el botón de guardar guardaba dos veces.
 *
 * ── Qué se fija ──────────────────────────────────────────────────────────────
 *
 * Se guarda sólo cuando nadie atendió ya la salida (la flecha «atrás» del
 * navegador, por ejemplo), hay cambios sin guardar, y la lección no cambió en
 * otro lado: con un choque a la vista decide la docente con los botones.
 */
export function guardaAlSalirDeEditar(estado: {
  /** Quien pidió salir ya resolvió qué hacer: el botón de guardar guardó, o «dejar de editar» eligió no guardar. */
  salidaAtendida: boolean;
  hayCambios: boolean;
  hayChoque: boolean;
}): boolean {
  if (estado.salidaAtendida) return false;
  if (!estado.hayCambios) return false;

  return !estado.hayChoque;
}
