import type { ToolSet } from 'ai';

/**
 * Decirle al modelo en qué paso de la ronda va.
 *
 * ── Por qué existe ───────────────────────────────────────────────────────────
 *
 * Medido en producción el 2026-09-12. Una ronda de 40 pasos para corregir tres
 * lecciones gastó así:
 *
 *     get_lesson_content     17
 *     read_source            12   (sobre las MISMAS dos fuentes del curso)
 *     get_course_structure    9   (idempotente dentro de la ronda)
 *     edit_lesson_content     2
 *
 * Treinta y ocho de cuarenta pasos fueron lecturas, e hizo dos de las ocho
 * ediciones que le faltaban. El techo no era chico: la misma tarea, pedida en
 * partes, hizo cuatro ediciones en cinco pasos. El techo fue lo único que cortó
 * el bucle.
 *
 * Lo que le faltaba era saber dónde estaba parado. El modelo no tiene forma de
 * ver el contador: entró en el bucle con trabajo pendiente y cero noción de
 * urgencia, y `stopWhen` lo cortó desde afuera sin que él se enterara nunca.
 *
 * ── Por qué no en todos los pasos ────────────────────────────────────────────
 *
 * Un aviso en cada resultado de herramienta es ruido en los primeros treinta
 * pasos, donde no cambia ninguna decisión, y el ruido constante se deja de
 * leer. Aparece cuando empieza a importar, y a partir de ahí en cada resultado.
 */

/**
 * Dónde está parado el modelo dentro de la ronda.
 *
 * Mutable a propósito: lo escribe `prepareStep` antes de cada paso y lo leen las
 * herramientas al devolver su resultado. Vive por ronda —el `ToolSet` se
 * reconstruye en cada pedido— y por eso NO puede ser un módulo global: dos
 * rondas simultáneas se pisarían el contador.
 */
export interface PresupuestoDePasos {
  paso: number;
  maxPasos: number;
}

/**
 * Fracción de la ronda a partir de la cual el aviso aparece.
 *
 * Tres cuartos: con 40 pasos entra en el 31, o sea con nueve por delante —
 * suficientes para terminar algo si deja de leer, y tarde para seguir
 * explorando.
 */
export const AVISO_DESDE_FRACCION = 0.75;

/**
 * El aviso para este paso, o `undefined` si todavía no hace falta.
 *
 * `paso` es 1-based: el primero de la ronda es 1.
 */
export function avisoDePresupuesto(params: { paso: number; maxPasos: number }): string | undefined {
  const { paso, maxPasos } = params;

  if (!Number.isFinite(paso) || !Number.isFinite(maxPasos) || maxPasos < 1 || paso < 1) return undefined;
  if (paso < Math.ceil(maxPasos * AVISO_DESDE_FRACCION)) return undefined;

  // Lo que se cuenta son LLAMADAS A HERRAMIENTA, no pasos, y son una menos que
  // los pasos por dos motivos que se suman:
  //
  // 1. El último paso de la ronda está reservado para la respuesta
  //    (`cerrarConRespuesta`): existe, pero no ejecuta nada.
  // 2. Este aviso viaja en el RESULTADO del paso `paso`, y un resultado se lee
  //    en el paso SIGUIENTE. Contar pasos en bruto llegaba siempre tarde: el
  //    aviso de "no queda ninguno" salía pegado al resultado del último paso,
  //    que nadie lee nunca —`stopWhen` corta ahí y no hay paso siguiente—, así
  //    que le pedía «reply now with what you did» a un lector inexistente.
  //
  // Con la resta, el número que el modelo lee es el que de verdad le queda por
  // gastar cuando lo lee. El pedido de cerrar ya no vive acá: entra por
  // `prepareStep`, como mensaje y antes de generar.
  const herramientasRestantes = Math.max(0, maxPasos - 1 - paso);

  if (herramientasRestantes === 0) {
    return (
      `Step ${paso} of ${maxPasos}. No tool calls left: your next turn is the reply that closes the round. ` +
      `Say what you built and what is still missing or created-but-empty.`
    );
  }

  if (herramientasRestantes === 1) {
    return (
      `Step ${paso} of ${maxPasos} — ONE tool call left, and then you only get to reply. ` +
      `Spend it on a CHANGE that finishes something, not on reading.`
    );
  }

  return (
    `Step ${paso} of ${maxPasos} — ${herramientasRestantes} tool calls left in this round. ` +
    `Spend them on CHANGES, not on reading: re-reading a source or the course structure returns what it already returned. ` +
    `If the work will not fit, do the most important part and say plainly what is left.`
  );
}

/**
 * Le agrega a cada resultado de herramienta en qué paso va la ronda.
 *
 * Envuelve el `ToolSet` en vez de tocar `executeAgentTool` porque ése es una
 * función de módulo y el presupuesto es por ronda: pasarlo por ahí exigiría
 * tocar los cuarenta sitios de llamada, y guardarlo en un global haría que dos
 * pedidos concurrentes se contaran mal el uno al otro.
 *
 * El aviso va en una clave propia y sólo sobre un objeto, para no pisar nada de
 * lo que la herramienta ya devuelve: es un agregado del servidor, no parte de la
 * respuesta.
 *
 * Vive acá y no en `chat-tools.ts` por dos motivos: es sobre el presupuesto, y
 * `chat-tools.ts` arrastra el saneador —o sea jsdom— que el entorno de tests de
 * la API no puede cargar. Acá el envoltorio se puede testear.
 */
export function conAvisoDePresupuesto(herramientas: ToolSet, presupuesto: PresupuestoDePasos): ToolSet {
  const envueltas: ToolSet = {};

  for (const [nombre, herramienta] of Object.entries(herramientas)) {
    const original = (herramienta as { execute?: (...args: never[]) => Promise<unknown> }).execute;

    if (typeof original !== 'function') {
      envueltas[nombre] = herramienta;
      continue;
    }

    envueltas[nombre] = {
      ...herramienta,
      execute: async (...args: never[]) => {
        const resultado = await original(...args);
        // Se lee ACÁ y no al construir el envoltorio: el contador avanza entre
        // paso y paso, y capturarlo antes dejaría el aviso clavado en el uno.
        const aviso = avisoDePresupuesto(presupuesto);

        if (!aviso || typeof resultado !== 'object' || resultado === null || Array.isArray(resultado)) {
          return resultado;
        }

        return { ...resultado, stepBudget: aviso };
      }
    } as ToolSet[string];
  }

  return envueltas;
}
