/**
 * Los mensajes que el panel manda en nombre del docente cuando toca un botón.
 *
 * ── Por qué existen ──────────────────────────────────────────────────────────
 *
 * «Aprobar y construir» y «Continuar» no son cosas que el docente escribe: son
 * gestos. Pero el chat es una lista de mensajes, así que cada gesto viaja como un
 * mensaje de usuario con un texto fijo. Ese texto estaba en inglés —«Implement
 * this plan.»— y la burbuja lo dibujaba tal cual, como si la docente lo hubiera
 * escrito ella, en un producto en castellano.
 *
 * Ahora el texto va en castellano (el modelo lo entiende igual, y el subagente
 * de construcción lo lee como su única orden) y la pantalla no lo muestra como
 * burbuja: lo dibuja como una ficha que dice qué gesto fue.
 *
 * ── Qué NO depende de estos textos ───────────────────────────────────────────
 *
 * El servidor no los compara: reconoce la aprobación por `metadata.plan`. Por
 * eso cambiarlos no rompe nada del lado de la API, y por eso las conversaciones
 * viejas —con el texto en inglés— se tienen que seguir reconociendo acá.
 */

/** La aprobación del plan. Viaja con `metadata.plan` (`implement_course_plan`). */
export const TEXTO_DE_APROBACION = 'Construí el curso según el plan aprobado.';

/** «Continuar», a mano o sola: la ronda anterior dejó trabajo del plan pendiente. */
export const TEXTO_DE_CONTINUACION = 'Seguí construyendo el plan desde donde quedó.';

/** Los textos que se mandaban antes, guardados en las conversaciones viejas. */
const APROBACION_EN_INGLES = 'Implement this plan.';
const CONTINUACION_EN_INGLES = 'Continue implementing the plan from where you left off.';

const TEXTOS_DE_APROBACION = new Set([TEXTO_DE_APROBACION, APROBACION_EN_INGLES]);
const TEXTOS_DE_CONTINUACION = new Set([TEXTO_DE_CONTINUACION, CONTINUACION_EN_INGLES]);

export type MensajeDeControl = 'aprobacion' | 'continuacion';

interface MensajeParaClasificar {
  role: string;
  parts?: unknown[];
  metadata?: unknown;
}

/** Todo el texto del mensaje, sin los bordes. Las partes que no son texto no cuentan. */
export function textoDelMensaje(mensaje: { parts?: unknown[] }): string {
  return (mensaje.parts ?? [])
    .map((parte) => {
      const posible = parte as { type?: unknown; text?: unknown } | null;

      return posible?.type === 'text' && typeof posible.text === 'string' ? posible.text : '';
    })
    .join('')
    .trim();
}

/**
 * Qué gesto del docente es este mensaje, o `null` si es algo que escribió.
 *
 * La aprobación se reconoce primero por su marca (`metadata.plan`), que es lo
 * que mira el servidor; el texto queda como segunda señal para un historial que
 * la hubiera perdido. La continuación no lleva marca: sólo su texto.
 */
export function mensajeDeControl(mensaje: MensajeParaClasificar): MensajeDeControl | null {
  if (mensaje.role !== 'user') return null;

  const plan = (mensaje.metadata as { plan?: { action?: unknown } } | undefined)?.plan;

  if (plan?.action === 'implement_course_plan') return 'aprobacion';

  const texto = textoDelMensaje(mensaje);

  if (TEXTOS_DE_APROBACION.has(texto)) return 'aprobacion';
  if (TEXTOS_DE_CONTINUACION.has(texto)) return 'continuacion';

  return null;
}
