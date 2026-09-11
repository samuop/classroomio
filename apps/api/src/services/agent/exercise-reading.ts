/**
 * Leer antes de preguntar: las preguntas de un ejercicio salen de lo que la
 * lección DICE.
 *
 * ── Por qué hace falta ahora ─────────────────────────────────────────────────
 *
 * Mientras el agente que construye el curso escribía él mismo cada lección, al
 * armar el ejercicio tenía el texto en su contexto. Ya no: la lección la escribe
 * `write_lesson` con contexto limpio y al constructor le vuelven unos cientos de
 * caracteres. Y desde que construye con el índice de fuentes y no con el
 * material entero, tampoco tiene las fuentes. Sin algo más, escribiría las
 * preguntas sobre lo que SUPONE que dice cada lección.
 *
 * Pedírselo en el prompt no alcanza cuando hay una presión en contra — acá,
 * ahorrar pasos. Así que se verifica: una pregunta para una lección cuyo texto
 * no se leyó en esta ronda se rechaza, y el rechazo dice exactamente qué ids
 * leer, para que corregirlo sea un solo paso.
 *
 * ── Qué cuenta como "leída" ──────────────────────────────────────────────────
 *
 * Una lección cuyo texto entero pasó por el contexto del modelo en esta ronda:
 * la leyó (`get_lesson_content`, `read_lessons`) o la escribió él mismo entera
 * (`create_lesson` con contenido, `update_lesson_content`). Las de
 * `write_lesson` NO cuentan — ésas las escribió otro.
 *
 * Es por ronda, a propósito: el historial de rondas anteriores se poda, y lo
 * que el modelo leyó hace tres rondas ya no está en su contexto.
 */

/** Tope de texto que devuelve una sola lectura de lecciones. */
export const MAX_LECTURA_LECCIONES_CHARS = 60_000;

export interface LeccionObjetivo {
  id: string;
  title: string | null;
}

/** Las lecciones que cubre el ejercicio y que el modelo no leyó en esta ronda. */
export function leccionesSinLeer(objetivo: LeccionObjetivo[], conocidas: ReadonlySet<string>): LeccionObjetivo[] {
  return objetivo.filter((leccion) => !conocidas.has(leccion.id));
}

/**
 * El rechazo, escrito para que el siguiente paso sea obvio: qué lecciones, y el
 * array de ids listo para pasarle a `read_lessons`.
 */
export function avisoLeerAntes(sinLeer: LeccionObjetivo[]): string {
  const lista = sinLeer.map((l) => `"${l.title ?? '(untitled)'}" (${l.id})`).join(', ');
  const ids = JSON.stringify(sinLeer.map((l) => l.id));

  return (
    `Nothing was created. These questions are for ${sinLeer.length === 1 ? 'a lesson' : 'lessons'} whose text you have not read in this round: ${lista}. ` +
    `Questions must test what a lesson actually says, not what you expect it to say. ` +
    `Call read_lessons with lessonIds ${ids}, write the questions from that text, and try again.`
  );
}
