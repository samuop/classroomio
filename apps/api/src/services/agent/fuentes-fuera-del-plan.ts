import { buscarFuente } from '@api/services/agent/plan-coverage';

/**
 * Las fuentes que llegaron después del plan y que el plan no usa.
 *
 * ── Lo que se midió (2026-09-29) ─────────────────────────────────────────────
 *
 * La docente agregó una fuente cinco minutos después de que el agente armara el
 * plan y dos minutos antes de aprobarlo. La aprobación mandó el plan viejo, en
 * el que ninguna lección declara esa fuente; el escritor carga sólo las fuentes
 * que el plan le asigna a cada lección, así que la construcción la ignoró
 * entera. Nada se lo dijo: ni el panel ni el agente.
 *
 * Esto no la mete en el plan por su cuenta —eso sería construir algo que el
 * docente no aprobó—. La nombra en el contexto del constructor, que se lo dice
 * al docente y le ofrece rehacer el plan.
 */

export interface FuenteConFecha {
  id: string;
  fileName: string;
  createdAt: string;
}

interface PlanConFuentes {
  sections: Array<{ items: Array<{ sources?: string[] }> }>;
}

/**
 * Para los planes que no traen sello: lo nuevo empieza un minuto después de la
 * fuente más nueva que el plan nombra.
 *
 * Toda fuente que el plan nombra existía cuando se armó. Las que suben juntas
 * —el asistente de creación promueve todas sus páginas en el mismo segundo—
 * quedan adentro del margen, así una página investigada que el plan decidió no
 * usar no se anuncia como nueva.
 */
export const MARGEN_SIN_SELLO_MS = 60_000;

type MensajeDelChat = {
  role?: string;
  parts?: Array<{ type?: string; state?: string }>;
  metadata?: { finishedAt?: unknown; plan?: { action?: unknown } };
};

/**
 * Cuándo se armó el plan que el docente aprobó.
 *
 * Es el `finishedAt` que el servidor pone en la metadata de cada respuesta,
 * tomado del mensaje del asistente que propuso el plan: el último con un
 * `generate_course_plan` terminado antes de la aprobación. `undefined` para los
 * planes propuestos antes de que existiera el sello.
 */
export function momentoDelPlan(messages: unknown[]): string | undefined {
  const mensajes = messages as MensajeDelChat[];
  let aprobacion = -1;

  for (let i = mensajes.length - 1; i >= 0; i--) {
    if (mensajes[i]?.role === 'user' && mensajes[i]?.metadata?.plan?.action === 'implement_course_plan') {
      aprobacion = i;
      break;
    }
  }

  for (let i = aprobacion - 1; i >= 0; i--) {
    const mensaje = mensajes[i];

    if (mensaje?.role !== 'assistant') continue;

    const proponeElPlan = (mensaje.parts ?? []).some(
      (parte) => parte?.type === 'tool-generate_course_plan' && parte?.state === 'output-available'
    );

    if (!proponeElPlan) continue;

    return typeof mensaje.metadata?.finishedAt === 'string' ? mensaje.metadata.finishedAt : undefined;
  }

  return undefined;
}

/**
 * Cuándo terminó la ronda de construcción anterior: la última respuesta del
 * asistente DESPUÉS de la aprobación del plan.
 *
 * Una fuente que ya existía entonces ya se avisó en esa ronda (o antes). Sin
 * esto el aviso entraba en CADA ronda mientras quedara algo por construir, y con
 * la continuación automática cada una le repetía a la docente lo mismo, sin
 * forma de cerrarlo.
 *
 * Sólo después de la aprobación porque el aviso va sólo en las rondas que
 * construyen: una charla entre el plan y la aprobación no avisó nada, y contarla
 * dejaría sin avisar la fuente que llegó antes de ella. `undefined` en la
 * primera ronda de construcción.
 */
export function momentoDeLaRondaAnterior(messages: unknown[]): string | undefined {
  const mensajes = messages as MensajeDelChat[];

  for (let i = mensajes.length - 1; i >= 0; i--) {
    const mensaje = mensajes[i];

    if (mensaje?.role === 'user' && mensaje.metadata?.plan?.action === 'implement_course_plan') return undefined;

    if (mensaje?.role === 'assistant' && typeof mensaje.metadata?.finishedAt === 'string') {
      return mensaje.metadata.finishedAt;
    }
  }

  return undefined;
}

/**
 * Las fuentes creadas después del plan que ningún ítem del plan declara.
 *
 * Las declaradas se resuelven con `buscarFuente`, la misma regla con la que el
 * escritor carga el material de cada lección: si acá una fuente contara como
 * declarada y allá no, el aviso callaría justo la que la construcción ignora.
 */
export function fuentesFueraDelPlan(params: {
  plan: PlanConFuentes;
  fuentes: FuenteConFecha[];
  /** El sello del plan (`momentoDelPlan`), cuando lo tiene. */
  planArmadoEn?: string;
  /**
   * Hasta cuándo ya se avisó (`momentoDeLaRondaAnterior`): las fuentes de antes
   * no se repiten. Sin él, se avisan todas.
   */
  avisadasHasta?: string;
}): FuenteConFecha[] {
  const { plan, fuentes } = params;
  const declaradas = new Set<string>();

  for (const seccion of plan.sections) {
    for (const item of seccion.items) {
      for (const nombre of item.sources ?? []) {
        const fuente = buscarFuente(nombre, fuentes);

        if (fuente) declaradas.add(fuente.id);
      }
    }
  }

  let desde: number | undefined;

  if (params.planArmadoEn) {
    desde = Date.parse(params.planArmadoEn);
  } else {
    const fechasDeclaradas = fuentes.filter((f) => declaradas.has(f.id)).map((f) => Date.parse(f.createdAt));

    // Sin sello y sin ninguna fuente declarada no hay con qué medir «después»:
    // mejor callar que anunciar como nuevo lo que ya estaba.
    if (fechasDeclaradas.length > 0) desde = Math.max(...fechasDeclaradas) + MARGEN_SIN_SELLO_MS;
  }

  if (desde === undefined || Number.isNaN(desde)) return [];

  // Lo que ya existía cuando terminó la ronda anterior ya se dijo.
  const avisadas = params.avisadasHasta ? Date.parse(params.avisadasHasta) : Number.NaN;
  const desdeLoNoAvisado = Number.isNaN(avisadas) ? desde : Math.max(desde, avisadas);

  return fuentes.filter((fuente) => !declaradas.has(fuente.id) && Date.parse(fuente.createdAt) > desdeLoNoAvisado);
}

/** El bloque del mensaje de contexto, o `undefined` si no hay nada que decir. */
export function avisoDeFuentesFueraDelPlan(fuentes: Array<{ id: string; fileName: string }>): string | undefined {
  if (fuentes.length === 0) return undefined;

  const lista = fuentes.map((fuente) => `- "${fuente.fileName}" (id: ${fuente.id})`).join('\n');

  return (
    `## Sources added after the plan\n\n` +
    `The teacher added ${fuentes.length} source(s) to this course AFTER the approved plan was made, and no item of the plan uses them:\n` +
    `${lista}\n\n` +
    `Keep building the approved plan as it is: do not work these into lessons on your own. ` +
    `In your reply, tell the teacher (in their language) that these sources are not part of the plan, and offer to redo the plan so it uses them. ` +
    `If they ask for that, call \`generate_course_plan\` with the complete revised plan, declaring those sources on the lessons they carry; nothing new is built until the teacher approves it.`
  );
}
