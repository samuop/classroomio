/**
 * Borrar: la única acción del agente que destruye trabajo del docente.
 *
 * ── Por qué no existía ───────────────────────────────────────────────────────
 *
 * El agente tenía 31 herramientas y ninguna de borrado. Cuando el docente le
 * pidió vaciar cuatro secciones que habían quedado sin material, contestó que no
 * podía y hubo que hacerlo a mano. Es deuda de producto, no una decisión: el
 * agente puede crear una sección y no puede deshacerla.
 *
 * ── Por qué no alcanza con agregar las herramientas ──────────────────────────
 *
 * Todo lo demás que hace el agente es corregible. Una lección mal escrita se
 * reescribe; una lección borrada no vuelve, y se lleva puestos su contenido, sus
 * ejercicios y el avance de los alumnos que la cursaron.
 *
 * Y el modo de fallar es conocido y está documentado en este mismo código: el
 * modelo inventa o confunde UUIDs. El prompt lo prohíbe en tres lugares
 * distintos, lo que es una buena señal de que pasa igual. Prohibirlo es lo que
 * ya se probó; acá hace falta que ese error no pueda ejecutarse.
 *
 * ── El mecanismo ─────────────────────────────────────────────────────────────
 *
 * Para borrar hay que decir el TÍTULO de lo que se va a borrar, y el servidor lo
 * contrasta contra el título real de esa fila. Si no coinciden, no se borra
 * nada.
 *
 * Es barato y ataca el error que de verdad ocurre: un id equivocado apunta a
 * OTRA fila, y esa otra fila casi nunca se llama igual. El modelo no puede
 * satisfacer las dos condiciones sin haber leído la estructura del curso, que es
 * exactamente lo que queremos obligarlo a hacer antes de destruir algo.
 *
 * No es una confirmación del docente —eso es de la interfaz, no de acá— pero sí
 * convierte «me equivoqué de id» en un error que se rechaza en vez de una
 * lección de otro que desaparece.
 */

/**
 * Forma comparable de un título.
 *
 * Deliberadamente tolerante con lo que no significa nada (mayúsculas, acentos,
 * espacios de más, comillas tipográficas, puntuación de borde) y estricta con lo
 * que sí: las palabras. «Comprender el organigrama» y «Comprender el
 * Organigrama» son lo mismo; «Comprender el organigrama» y «Comprender la
 * estructura» no.
 */
function normalizar(titulo: string): string {
  return titulo
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * ¿El título declarado es el de la fila que se va a borrar?
 *
 * Exige coincidencia completa, no contención: «Introducción» está contenido en
 * «Introducción a la seguridad», y aceptar eso reabriría justo el agujero que
 * esto cierra — un título parcial que coincide con la fila equivocada.
 */
export function confirmacionCoincide(declarado: string, real: string): boolean {
  const a = normalizar(declarado);
  const b = normalizar(real);

  return a.length > 0 && a === b;
}

/**
 * Lo que se le dice al modelo cuando el título no coincide.
 *
 * Nombra el título real: sin eso, el modelo no puede distinguir «me equivoqué de
 * id» de «me equivoqué de título», y el reintento sería a ciegas. Decirle qué
 * hay realmente en ese id es lo que convierte el rechazo en algo accionable.
 */
export function avisoDeConfirmacion(params: { tipo: string; id: string; declarado: string; real: string }): string {
  return (
    `Refusing to delete: you said this ${params.tipo} is titled "${params.declarado}", but ${params.id} is actually "${params.real}". ` +
    `Nothing was deleted. Call get_course_structure, find the ${params.tipo} the teacher actually meant, and retry with its real id and title. ` +
    `Deleting the wrong item destroys work that cannot be recovered, so this check will not be skipped.`
  );
}
