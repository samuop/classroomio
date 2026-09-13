import { getPendingToolLine, type NombrarPorId, type ToolLineUi } from './tool-labels';
import { getAgentToolInput, getAgentToolName, getAgentToolStatus, isAgentToolPart } from './tool-parts';

/**
 * Qué está haciendo el agente AHORA, en una línea.
 *
 * Una ronda de construcción dura minutos, y lo que el docente veía era una
 * tarjeta con la lista de pasos creciendo y un «Pensando en su solicitud...»
 * fijo entre paso y paso. La lista informa qué ya pasó; lo que falta mientras
 * espera es qué está pasando: «Buscando "extintor clase b" en las fuentes»,
 * «Leyendo "Manual de seguridad.pdf"», «Escribiendo "Uso del extintor"».
 *
 * Se lee de la ÚLTIMA parte con sentido del mensaje que se está escribiendo:
 * una herramienta corriendo gana; si la última parte es un razonamiento, se
 * muestra su título; si es texto, el agente está redactando la respuesta.
 */

export type LoQueHaceAhora =
  | { tipo: 'herramienta'; linea: ToolLineUi }
  | { tipo: 'pensando'; titulo: string | null }
  | { tipo: 'escribiendo' };

export interface ActividadDelAgente {
  ahora: LoQueHaceAhora;
  /** Acciones con herramientas. Las tarjetas (plan, formularios) no cuentan. */
  pasos: number;
  hechos: number;
  fallidos: number;
}

/** Herramientas que se muestran como tarjeta propia y no como paso. */
const TARJETAS = new Set(['generate_course_plan', 'ask_template_questions', 'ask_discovery_questions']);

/**
 * El título del último bloque de razonamiento.
 *
 * Gemini resume lo que piensa en bloques que empiezan con una línea en negrita
 * («**Locating the protocol**»). El título es lo que cabe en una línea; el
 * resto del bloque queda para quien despliega el detalle.
 */
export function tituloDelPensamiento(texto: string): string | null {
  const titulos = [...texto.matchAll(/^\s*\*\*(.+?)\*\*\s*$/gm)];
  const ultimo = titulos.at(-1)?.[1]?.trim();

  return ultimo ? ultimo : null;
}

export function actividadDelAgente(partes: unknown[], nombrar?: NombrarPorId): ActividadDelAgente {
  let pasos = 0;
  let hechos = 0;
  let fallidos = 0;
  let ahora: LoQueHaceAhora = { tipo: 'pensando', titulo: null };

  for (const parte of partes) {
    if (isAgentToolPart(parte)) {
      const nombre = getAgentToolName(parte);

      if (!nombre) continue;

      const estado = getAgentToolStatus(parte);

      if (!TARJETAS.has(nombre)) {
        pasos += 1;
        if (estado === 'completed') hechos += 1;
        if (estado === 'failed') fallidos += 1;
      }

      // Una herramienta que ya terminó deja al agente decidiendo el paso siguiente.
      ahora =
        estado === 'in_progress'
          ? { tipo: 'herramienta', linea: getPendingToolLine(nombre, getAgentToolInput(parte), nombrar) }
          : { tipo: 'pensando', titulo: null };

      continue;
    }

    const { type, text } = (parte ?? {}) as { type?: unknown; text?: unknown };

    if (type === 'reasoning') {
      ahora = { tipo: 'pensando', titulo: tituloDelPensamiento(typeof text === 'string' ? text : '') };
    } else if (type === 'text' && typeof text === 'string' && text.trim()) {
      ahora = { tipo: 'escribiendo' };
    } else if (type === 'step-start') {
      ahora = { tipo: 'pensando', titulo: null };
    }
  }

  return { ahora, pasos, hechos, fallidos };
}

/** «59 s», «3 min 5 s»: lo que tardó, legible de un vistazo. */
export function duracionLegible(ms: number): { minutos: number; segundos: number } {
  const total = Math.max(0, Math.round(ms / 1000));

  return { minutos: Math.floor(total / 60), segundos: total % 60 };
}
