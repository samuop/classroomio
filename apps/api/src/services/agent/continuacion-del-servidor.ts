/**
 * Si el servidor sigue construyendo cuando el modelo cierra con el plan a medias.
 *
 * ── Por qué en el servidor ───────────────────────────────────────────────────
 *
 * La ronda tenía un techo de 40 pasos y una construcción de cualquier tamaño lo
 * pasaba. Al cortarse, el NAVEGADOR mandaba «Seguí construyendo el plan desde
 * donde quedó» y arrancaba otra ronda (`auto-continue.ts`). Tres problemas:
 *
 * - cerrar la pestaña frenaba la construcción (auditoría del 2026-09-23, R4);
 * - cada ronda nueva arrancaba sin memoria de lo que había hecho la anterior;
 * - el modelo también cierra antes de tiempo SIN llegar al techo («listo, el
 *   curso está completo» con lecciones vacías), y ahí sólo un botón lo salvaba.
 *
 * Ahora la ronda no tiene techo de pasos (salvo uno de emergencia) y, si el
 * modelo cierra con el plan incompleto, el servidor arranca otro TRAMO dentro
 * de la misma respuesta y del mismo mensaje del asistente. La docente ve una
 * sola respuesta que sigue trabajando.
 *
 * ── Los frenos ───────────────────────────────────────────────────────────────
 *
 * Un tramo que no avanzó no se repite: si el modelo cerró sin guardar nada, otro
 * tramo igual va a hacer lo mismo y gastar. Tampoco se sigue si la docente
 * tocó «Detener», si la empresa se quedó sin cupo, si el tramo terminó por un
 * error o por el techo, si el modelo le hizo una pregunta a la docente (seguir
 * sería contestarse solo), ni después de `MAX_TRAMOS`.
 *
 * Pura: lo que decide se puede probar entero.
 */

/** Cuántos tramos puede tener una respuesta, el primero incluido. */
export const MAX_TRAMOS = 6;

/** Cada cuántos pasos se mira si a la empresa le queda cupo. Ver `cupoAgotado`. */
export const PASOS_ENTRE_CONTROLES_DE_CUPO = 10;

/** El último paso de una ronda que se quedó sin cupo: sin herramientas, sólo la respuesta. */
export const AVISO_SIN_CUPO =
  'The organisation has run out of AI credit, so no more tools will run in this round. Reply now, in the language of the conversation: say what you built, what is still missing, and that the work stops here until more credit is added.';

export type MotivoDeCierre =
  | 'no_es_construccion'
  | 'plan_completo'
  | 'detenida'
  | 'sin_cupo'
  | 'no_termino_bien'
  | 'techo_de_pasos'
  | 'pregunta_a_la_docente'
  | 'sin_avance'
  | 'tope_de_tramos';

export type DecisionDeTramo = { seguir: true } | { seguir: false; motivo: MotivoDeCierre };

export function decidirOtroTramo(params: {
  esConstruccion: boolean;
  /** Lo que falta del plan, medido por el servidor después del último paso. */
  planPendiente: { pendingCount: number; emptyCount: number } | undefined;
  detenida: boolean;
  sinCupo: boolean;
  /** Por qué terminó el último paso del tramo (`stop` = el modelo dejó de llamar herramientas). */
  finishReason: string | undefined;
  pasosTotales: number;
  maxPasos: number;
  /** Escrituras que salieron bien en este tramo. */
  escriturasDelTramo: number;
  tramo: number;
  /** El texto con que el modelo cerró el tramo. */
  textoFinal: string;
}): DecisionDeTramo {
  if (!params.esConstruccion) return { seguir: false, motivo: 'no_es_construccion' };

  const falta = params.planPendiente;

  if (!falta || falta.pendingCount + falta.emptyCount === 0) return { seguir: false, motivo: 'plan_completo' };
  if (params.detenida) return { seguir: false, motivo: 'detenida' };
  if (params.sinCupo) return { seguir: false, motivo: 'sin_cupo' };
  if (params.pasosTotales >= params.maxPasos) return { seguir: false, motivo: 'techo_de_pasos' };
  if (params.finishReason !== 'stop') return { seguir: false, motivo: 'no_termino_bien' };
  if (terminaConPregunta(params.textoFinal)) return { seguir: false, motivo: 'pregunta_a_la_docente' };
  if (params.escriturasDelTramo === 0) return { seguir: false, motivo: 'sin_avance' };
  if (params.tramo >= MAX_TRAMOS) return { seguir: false, motivo: 'tope_de_tramos' };

  return { seguir: true };
}

/**
 * Si el cierre le pregunta algo a la docente.
 *
 * Mira el final del texto, sin el formato: «¿Querés que siga con la sección 3?»
 * al cerrar es una pregunta de verdad, y seguir sin respuesta sería decidir por
 * ella. Un signo de pregunta en el medio de un resumen no cuenta.
 */
export function terminaConPregunta(texto: string): boolean {
  const limpio = texto
    .replace(/[*_`>#]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  return /[?？]\s*["»”')\]]*$/.test(limpio);
}

/**
 * La orden del tramo nuevo, en inglés como lo demás que lee el modelo.
 *
 * No la ve la docente: va en los mensajes del modelo, no en la conversación.
 */
export function textoDeContinuacion(falta: { pendingCount: number; emptyCount: number }): string {
  const partes = [
    falta.pendingCount > 0 ? `${falta.pendingCount} item(s) still missing` : '',
    falta.emptyCount > 0 ? `${falta.emptyCount} created but still empty` : ''
  ].filter(Boolean);

  return (
    `[Server] The approved plan is not finished: ${partes.join(', ')}. ` +
    'This is not a new request from the teacher — keep building the approved plan from where you left off. ' +
    'Do not redo anything the server log lists as saved. When every item is built, reply to the teacher with what was built.'
  );
}

/** Para el log: por qué la respuesta cerró donde cerró. */
export const MOTIVOS_EN_CASTELLANO: Record<MotivoDeCierre, string> = {
  no_es_construccion: 'no era una construcción',
  plan_completo: 'el plan quedó completo',
  detenida: 'la docente tocó «Detener»',
  sin_cupo: 'la empresa se quedó sin cupo',
  no_termino_bien: 'el último paso no terminó normal',
  techo_de_pasos: 'se llegó al techo de emergencia',
  pregunta_a_la_docente: 'el modelo le preguntó algo a la docente',
  sin_avance: 'el tramo no guardó nada',
  tope_de_tramos: 'se llegó al máximo de tramos'
};
