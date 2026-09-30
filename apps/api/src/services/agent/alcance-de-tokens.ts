import { getLatestImplementationPlan } from '@api/services/agent/chat-context';

/**
 * De dónde salen, además de las fuentes de la lección, los lugares donde un
 * nombre o un número NO es un invento: las palabras de la docente y el ítem del
 * plan que ella aprobó. Las fuentes del curso las carga quien llama.
 *
 * ── Qué se midió ─────────────────────────────────────────────────────────────
 *
 * Producción, 2026-09-29. La docente escribió en su pedido que el curso era
 * para los vendedores de un comercio abierto «24 hs»; el constructor lo copió en la consigna de
 * cada lección, el escritor le hizo caso, y el chequeo de tokens —que miraba
 * sólo las fuentes asignadas a la lección— lo marcó como inventado en tres
 * lecciones seguidas. El rebote lo borró de dos y el constructor de la tercera.
 * Las propias palabras de la docente terminaron en su informe como «datos que
 * no figuran en las fuentes».
 *
 * Todo lo de acá es texto puro y sin red: se puede fijar en tests con los
 * mensajes y el plan tal como los arma la app.
 */

type ParteDeMensaje = { type?: unknown; text?: unknown };
type MensajeDeChat = { role?: unknown; parts?: unknown; content?: unknown };

/** El texto que la docente escribió en un mensaje: sus partes de texto. */
function textoDelMensaje(mensaje: MensajeDeChat): string {
  if (Array.isArray(mensaje.parts)) {
    return (mensaje.parts as ParteDeMensaje[])
      .filter((parte) => parte?.type === 'text' && typeof parte.text === 'string')
      .map((parte) => parte.text as string)
      .join('\n');
  }

  // Mensajes guardados con la forma vieja, antes de `parts`.
  return typeof mensaje.content === 'string' ? mensaje.content : '';
}

/**
 * Todo lo que la docente escribió en la conversación, sin repetir.
 *
 * Sólo los mensajes `user`: lo que dijo el asistente no es un respaldo, es lo
 * que se está verificando. Recibe varias listas porque las palabras se juntan
 * de dos lugares —la conversación guardada y los mensajes de esta ronda— y un
 * mismo mensaje puede estar en las dos.
 */
export function palabrasDeLaDocente(...listas: unknown[][]): string {
  const vistos = new Set<string>();
  const textos: string[] = [];

  for (const lista of listas) {
    for (const mensaje of lista) {
      if (!mensaje || typeof mensaje !== 'object') continue;
      if ((mensaje as MensajeDeChat).role !== 'user') continue;

      const texto = textoDelMensaje(mensaje as MensajeDeChat).trim();

      if (!texto || vistos.has(texto)) continue;

      vistos.add(texto);
      textos.push(texto);
    }
  }

  return textos.join('\n\n');
}

function normalizarTitulo(titulo: string): string {
  return titulo
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * El título, la descripción y el cambio pedido del ítem aprobado del plan que
 * corresponde a esta lección, como un solo texto. Vacío si no hay plan o si el
 * ítem no aparece.
 *
 * Se busca por título —el del registro del plan para ese `planKey`, o el de la
 * lección— porque es lo que ata las dos cosas: el constructor crea la lección
 * con el título del ítem.
 */
export function textoDelItemDelPlan(mensajes: unknown[], titulos: Array<string | null | undefined>): string {
  const plan = getLatestImplementationPlan(mensajes);

  if (!plan) return '';

  const buscados = new Set(titulos.filter((t): t is string => Boolean(t?.trim())).map(normalizarTitulo));

  if (buscados.size === 0) return '';

  const item = plan.sections
    .flatMap((seccion) => seccion.items)
    .find((candidato) => buscados.has(normalizarTitulo(candidato.title)));

  if (!item) return '';

  return [item.title, item.description, item.changes].filter(Boolean).join('\n');
}
