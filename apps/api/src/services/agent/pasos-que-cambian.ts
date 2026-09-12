/**
 * Qué pasos de una ronda pueden haber movido el progreso del plan.
 *
 * ── Para qué ─────────────────────────────────────────────────────────────────
 *
 * El progreso del plan se recalcula contra la base al final de cada paso que
 * pudo haber cambiado el curso, y no una sola vez al terminar la ronda. El
 * porqué está en `agent.ts`, junto a `recalcularProgresoDelPlan`: recalcularlo
 * en `onFinish` llega tarde y el dato nunca viaja al panel.
 *
 * Recalcular en CADA paso serían tres consultas por paso, cuarenta veces por
 * ronda, casi todas después de una lectura que no cambió nada. Esto separa los
 * pasos que valen la pena.
 *
 * ── Por qué una lista de LECTURAS y no de escrituras ────────────────────────
 *
 * Una herramienta de escritura que se agregue mañana y nadie anote acá tiene
 * que disparar el recálculo igual. Si la lista fuera de escrituras, esa
 * herramienta quedaría afuera en silencio y el progreso volvería a mentir,
 * que es exactamente el defecto que esto arregla. Con una lista de lecturas, lo
 * desconocido cuenta como escritura: el error posible es una consulta de más,
 * nunca un progreso viejo.
 *
 * No sirve usar el registro de la ronda como disparador: sólo anota lecciones.
 * Una ronda que arma los bloques del examen final no deja nada en el registro y
 * sí cambia el plan.
 */
export const HERRAMIENTAS_DE_LECTURA: ReadonlySet<string> = new Set([
  'ask_discovery_questions',
  'ask_template_questions',
  'check_course_go_live_readiness',
  'fetch_documentation_url',
  'generate_course_plan',
  'get_course_structure',
  'get_exercise_details',
  'get_lesson_content',
  'read_lessons',
  'read_source',
  'search_document',
  'search_lessons',
  'search_web'
]);

/** Si alguno de los nombres puede haber dejado el curso distinto de como estaba. */
export function pasoPudoCambiarElCurso(nombresDeHerramientas: readonly string[]): boolean {
  return nombresDeHerramientas.some((nombre) => !HERRAMIENTAS_DE_LECTURA.has(nombre));
}
