import type { ModelMessage } from 'ai';

/**
 * La dieta de contexto que NO se come la lectura que el modelo todavía no usó.
 *
 * ── Qué se midió ─────────────────────────────────────────────────────────────
 *
 * Producción, 2026-09-22, ronda 1 de «subí una circular y actualizá la sección»:
 * 23 `get_lesson_content` + 16 `get_exercise_details`, TRES ediciones, y la
 * ronda terminó contra el tope de 40 pasos. La orden de trabajo tenía cinco
 * targets; el modelo leyó los cinco y, al leer el quinto, ya no tenía el
 * primero. Ciclo de cinco lecturas repetido siete veces = 35 de los 40 pasos.
 *
 * La causa estaba acá: `prepareStep` aplicaba `pruneMessages({ toolCalls:
 * 'before-last-4-messages' })`, que borra TODO resultado de herramienta anterior
 * a los últimos 4 mensajes, sin excepción. Un resultado que se poda antes de
 * usarse obliga a pedirlo de nuevo, y pedirlo de nuevo lo vuelve a poner al
 * final de la cola: eso no es una dieta, es un bucle. Antes no se notaba porque
 * la orden de trabajo tenía un ítem: leía uno y lo editaba.
 *
 * ── La regla ─────────────────────────────────────────────────────────────────
 *
 * Lo que la orden de trabajo manda leer tiene que sobrevivir hasta que se edite.
 * Así que de `get_lesson_content` y `get_exercise_details` —y sólo de esos dos—
 * se conserva la lectura MÁS RECIENTE de cada pieza aunque esté vieja. Todo lo
 * demás se poda como siempre, y las lecturas repetidas de la misma pieza
 * también: la que vale es la última, porque el contenido pudo cambiar entre una
 * y otra.
 *
 * El tope de ocho es lo que impide que la excepción se coma la dieta: ocho
 * lecciones abiertas es más de lo que cualquier orden de trabajo medida pidió,
 * y la novena empuja a la más vieja afuera.
 */

/** Las dos lecturas que una orden de trabajo obliga a tener a mano, y el campo que nombra la pieza. */
const LECTURAS_CON_PIEZA: Readonly<Record<string, string>> = {
  get_lesson_content: 'lessonId',
  get_exercise_details: 'exerciseId'
};

/**
 * Cuántas lecturas distintas se conservan.
 *
 * Medido: la orden de trabajo más larga de las pruebas tenía cinco targets.
 * Ocho deja margen sin que la excepción deje de ser una excepción.
 */
export const MAX_LECTURAS_CONSERVADAS = 8;

type ParteDeHerramienta = {
  type: string;
  toolCallId?: string;
  toolName?: string;
  input?: unknown;
  approvalId?: string;
};

function partes(message: ModelMessage): ParteDeHerramienta[] {
  if (message.role !== 'assistant' && message.role !== 'tool') return [];
  if (typeof message.content === 'string') return [];

  return message.content as unknown as ParteDeHerramienta[];
}

/**
 * La pieza que una lectura nombra, TAL CUAL vino en el `input`.
 *
 * No se resuelve la manija a UUID a propósito: resolverla necesitaría el curso,
 * y acá no hay forma de consultarlo (esto corre entre paso y paso, sincrónico).
 * Con que el modelo repita la misma forma —`S1.L2` o el UUID— alcanza para
 * deduplicar; si no la repite, se conserva una lectura de más, que es el lado
 * barato del error.
 */
function piezaLeida(parte: ParteDeHerramienta): string | undefined {
  const campo = parte.toolName ? LECTURAS_CON_PIEZA[parte.toolName] : undefined;

  if (!campo) return undefined;

  const input = parte.input as Record<string, unknown> | undefined;
  const valor = input?.[campo];

  return typeof valor === 'string' && valor.trim() ? `${parte.toolName}:${valor.trim().toUpperCase()}` : undefined;
}

/**
 * Los `toolCallId` de las lecturas que hay que salvar de la poda: la más
 * reciente de cada pieza, hasta {@link MAX_LECTURAS_CONSERVADAS}.
 */
export function lecturasAConservar(
  messages: readonly ModelMessage[],
  maximo = MAX_LECTURAS_CONSERVADAS
): Set<string> {
  /** Por pieza, la última lectura vista y en qué posición del hilo estaba. */
  const ultimaPorPieza = new Map<string, { toolCallId: string; posicion: number }>();
  let posicion = 0;

  for (const message of messages) {
    for (const parte of partes(message)) {
      posicion += 1;

      if (parte.type !== 'tool-call' || !parte.toolCallId) continue;

      const pieza = piezaLeida(parte);

      if (!pieza) continue;

      // Se pisa a propósito: entre dos lecturas de la misma lección, la que
      // describe el curso de ahora es la última.
      ultimaPorPieza.set(pieza, { toolCallId: parte.toolCallId, posicion });
    }
  }

  return new Set(
    [...ultimaPorPieza.values()]
      .sort((a, b) => b.posicion - a.posicion)
      .slice(0, maximo)
      .map((lectura) => lectura.toolCallId)
  );
}

/**
 * La poda de herramientas de `pruneMessages`, con exclusiones.
 *
 * Misma forma que `pruneMessages({ toolCalls: 'before-last-N-messages' })` del
 * AI SDK —se sacan las partes `tool-call` (assistant) y `tool-result` (tool)
 * anteriores a los últimos N mensajes, y los mensajes que quedan vacíos se
 * eliminan— con un conjunto de `toolCallId` que sobreviven igual. Está escrita
 * acá porque `pruneMessages` no admite exclusiones: su filtro por `tools` es
 * por NOMBRE de herramienta, y lo que hay que conservar es una llamada
 * concreta, no todas las de ese nombre.
 */
export function podarHerramientas(params: {
  messages: readonly ModelMessage[];
  /** Cuántos mensajes del final quedan intactos. */
  ultimos: number;
  conservar: ReadonlySet<string>;
}): ModelMessage[] {
  const { messages, ultimos, conservar } = params;
  const desdeIntacto = messages.length - ultimos;

  // Lo mismo que hace `pruneMessages`: una llamada cuyo resultado está en los
  // mensajes intactos tiene que conservar su `tool-call`, o el proveedor recibe
  // un resultado huérfano y rechaza el pedido entero.
  const enLosUltimos = new Set<string>(conservar);
  const aprobacionesEnLosUltimos = new Set<string>();

  for (const message of messages.slice(-ultimos)) {
    for (const parte of partes(message)) {
      if ((parte.type === 'tool-call' || parte.type === 'tool-result') && parte.toolCallId) {
        enLosUltimos.add(parte.toolCallId);
      } else if (
        (parte.type === 'tool-approval-request' || parte.type === 'tool-approval-response') &&
        parte.approvalId
      ) {
        aprobacionesEnLosUltimos.add(parte.approvalId);
      }
    }
  }

  const podados = messages.map((message, indice) => {
    if ((message.role !== 'assistant' && message.role !== 'tool') || typeof message.content === 'string') {
      return message;
    }

    if (ultimos > 0 && indice >= desdeIntacto) return message;

    const contenido = (message.content as unknown as ParteDeHerramienta[]).filter((parte) => {
      if (
        parte.type !== 'tool-call' &&
        parte.type !== 'tool-result' &&
        parte.type !== 'tool-approval-request' &&
        parte.type !== 'tool-approval-response'
      ) {
        return true;
      }

      if ((parte.type === 'tool-call' || parte.type === 'tool-result') && parte.toolCallId) {
        return enLosUltimos.has(parte.toolCallId);
      }

      return !!parte.approvalId && aprobacionesEnLosUltimos.has(parte.approvalId);
    });

    return { ...message, content: contenido } as ModelMessage;
  });

  // Un mensaje que se quedó sin partes no se manda: el proveedor lo rechaza.
  return podados.filter((message) => message.content.length > 0);
}
