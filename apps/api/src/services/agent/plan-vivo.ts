/**
 * El plan aprobado es un acuerdo VIVO mientras se construye, y es historia después.
 *
 * ── Lo que pasaba (producción, 2026-11-07) ───────────────────────────────────
 *
 * Un plan aprobado el 15/10 pedía un examen final de cinco bloques. Se construyó
 * entero. El 30/10, en otra conversación, la docente pidió dos veces que el final
 * fuera sólo de los módulos 1 y 2, y el asistente lo achicó. Cincuenta alumnos lo
 * rindieron. El 7/11 la docente escribió «revisar la pregunta sugerida» en la
 * conversación del plan, y la ronda —en modo construir, porque alguna vez hubo un
 * plan— recibió el JSON del 15/10 presentado como «aprobado en el último mensaje,
 * para ejecutar ya, la fuente canónica». El modelo «alineó» el examen al JSON:
 * doce preguntas nuevas, y las cincuenta notas se vinieron abajo.
 *
 * El servidor había medido el plan completo (32/32) y no empujó nada: el daño lo
 * hizo el JSON viejo dicho como orden. Por eso esto tiene dos partes:
 *
 * - Un plan terminado se CIERRA (`huellaDelPlan`, `cerrarPlan` en el registro) y
 *   deja de viajar como orden: el contexto dice que es historia.
 * - Mientras se construye, las decisiones de la docente lo ENMIENDAN
 *   (`update_plan`), y el JSON que ve el modelo es el enmendado
 *   (`planConEnmiendas`).
 */
import { createHash } from 'node:crypto';

import { abrirPlan, cerrarPlan, leerCierreDelPlan, type PlanRegistryEntry } from '@cio/db/queries/agent';

/** Lo mínimo del plan que esto necesita: estructural, para no atarse al esquema entero. */
interface PlanItemComoViene {
  type: string;
  title: string;
  description?: string;
  [clave: string]: unknown;
}

interface PlanComoViene {
  sections: Array<{ title: string; items: PlanItemComoViene[]; [clave: string]: unknown }>;
  [clave: string]: unknown;
}

/** Misma normalización que el registro y el ancla: así se encuentran las claves. */
function normalizarTitulo(titulo: string | null | undefined): string {
  return (titulo ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Qué plan es este, para no confundir el cierre de uno viejo con uno nuevo.
 *
 * Sólo la estructura (secciones, ítems, descripciones): las reglas de la docente
 * se pueden editar en la pantalla del plan sin que eso sea otro plan que
 * construir.
 */
export function huellaDelPlan(plan: PlanComoViene): string {
  const forma = plan.sections.map((seccion) => ({
    t: seccion.title,
    i: seccion.items.map((item) => [item.type, item.title, item.description ?? ''])
  }));

  return createHash('sha1').update(JSON.stringify(forma)).digest('hex');
}

interface AlcanceDelPlan {
  orgId: string;
  courseId: string;
  conversationId?: string | null;
  userId: string;
}

/** Lo que hace falta del progreso para decidir si el plan terminó. */
interface ProgresoMedido {
  pendingCount: number;
  emptyCount: number;
}

/**
 * ¿El plan de esta conversación ya se terminó? Se pregunta al EMPEZAR la ronda,
 * antes de elegir el modo, porque de eso depende todo lo demás: el prompt, las
 * herramientas, si viaja el JSON del plan.
 *
 * - La ronda de aprobación nunca está terminada, y reabre: re-aprobar un plan
 *   idéntico a uno cerrado es pedir construirlo otra vez.
 * - Si el cierre guardado es de ESTE plan (misma huella), terminó.
 * - Si no, se mide. Completo (nada pendiente ni vacío) ⇒ se cierra y se guarda.
 *   El orden de las secciones no cuenta: un orden distinto no es algo por
 *   construir, y un plan que no se cerrara por eso viajaría como orden siempre.
 *
 * Devuelve también el registro que leyó para medir, así quien llama arma el
 * plan enmendado sin volver a la base. Nunca tira: si la base falla, el plan se
 * trata como abierto, que es como se comportaba todo antes de esto.
 */
export async function estadoDelPlanAlEmpezar(params: {
  alcance: AlcanceDelPlan;
  plan: PlanComoViene;
  esRondaDeAprobacion: boolean;
  medir: () => Promise<{ progreso: ProgresoMedido | undefined; registro: PlanRegistryEntry[] }>;
  /** Para los tests; en la app, las del registro. */
  base?: {
    leerCierre: typeof leerCierreDelPlan;
    cerrar: typeof cerrarPlan;
    abrir: typeof abrirPlan;
  };
}): Promise<{ terminado: boolean; registro: PlanRegistryEntry[] }> {
  const base = params.base ?? { leerCierre: leerCierreDelPlan, cerrar: cerrarPlan, abrir: abrirPlan };

  try {
    if (params.esRondaDeAprobacion) {
      await base.abrir(params.alcance);
      return { terminado: false, registro: [] };
    }

    const huella = huellaDelPlan(params.plan);
    const cierre = await base.leerCierre(params.alcance);

    if (cierre?.huella === huella) return { terminado: true, registro: [] };

    const { progreso, registro } = await params.medir();

    if (progreso && progreso.pendingCount === 0 && progreso.emptyCount === 0) {
      await base.cerrar({ ...params.alcance, huella });
      return { terminado: true, registro };
    }

    return { terminado: false, registro };
  } catch (error) {
    console.error('[plan-vivo] no se pudo saber si el plan terminó; se trata como abierto:', error);
    return { terminado: false, registro: [] };
  }
}

/** Las claves del registro, indexadas como las busca el ancla. */
function indiceDelRegistro(registro: PlanRegistryEntry[]) {
  const seccionPorTitulo = new Map<string, PlanRegistryEntry>();
  const itemPorRuta = new Map<string, PlanRegistryEntry>();

  for (const entrada of registro) {
    if (entrada.kind === 'section') {
      seccionPorTitulo.set(normalizarTitulo(entrada.title), entrada);
    } else {
      itemPorRuta.set(`${entrada.sectionKey ?? ''}::${normalizarTitulo(entrada.title)}`, entrada);
    }
  }

  return { seccionPorTitulo, itemPorRuta };
}

/**
 * El plan como la docente lo quiere HOY: el aprobado, con sus enmiendas.
 *
 * Lo que ella sacó no viaja (una sección sacada se lleva sus ítems); lo que
 * cambió viaja con la descripción nueva. Es el JSON que lee el modelo: si viajara
 * el original, la enmienda sólo sería un renglón del ancla discutiéndole al
 * «canonical source» de más abajo.
 */
export function planConEnmiendas<P extends PlanComoViene>(plan: P, registro: PlanRegistryEntry[]): P {
  if (!registro.some((entrada) => entrada.enmienda)) return plan;

  const { seccionPorTitulo, itemPorRuta } = indiceDelRegistro(registro);

  const secciones = plan.sections.flatMap((seccion) => {
    const regSeccion = seccionPorTitulo.get(normalizarTitulo(seccion.title));

    if (regSeccion?.enmienda?.accion === 'sacar') return [];

    const items = seccion.items.flatMap((item) => {
      const regItem = itemPorRuta.get(`${regSeccion?.key ?? ''}::${normalizarTitulo(item.title)}`);
      const enmienda = regItem?.enmienda;

      if (enmienda?.accion === 'sacar') return [];
      if (enmienda?.accion === 'cambiar' && enmienda.descripcion) {
        return [{ ...item, description: enmienda.descripcion }];
      }

      return [item];
    });

    return [{ ...seccion, items }];
  });

  return { ...plan, sections: secciones };
}

/**
 * Normaliza para comparar lo que escribió la docente con lo que el modelo dice
 * que escribió: sin tildes, sin mayúsculas, sin puntuación, espacios simples.
 *
 * Sin tildes porque la docente escribe «modulo» y el modelo copia «módulo»; sin
 * puntuación porque las comillas y los puntos finales cambian al citar.
 */
export function normalizarParaCitar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Lo mínimo para que una cita respalde una decisión: «sí» no alcanza. */
const LARGO_MINIMO_DE_LA_CITA = 10;

/**
 * ¿Estas palabras las escribió la docente en esta conversación?
 *
 * Es lo que hace que una enmienda sea de ella: el modelo no puede achicar el plan
 * para darlo por terminado, porque tendría que citar algo que ella no dijo.
 */
export function lasEscribioLaDocente(palabras: string, textosDeLaDocente: readonly string[]): boolean {
  const cita = normalizarParaCitar(palabras);

  if (cita.length < LARGO_MINIMO_DE_LA_CITA || !cita.includes(' ')) return false;

  return textosDeLaDocente.some((texto) => normalizarParaCitar(texto).includes(cita));
}

/** El texto de los mensajes de la docente, en orden. */
export function textosDeLaDocente(mensajes: unknown[]): string[] {
  return mensajes.flatMap((mensaje) => {
    const m = mensaje as { role?: unknown; parts?: unknown } | null;

    if (m?.role !== 'user' || !Array.isArray(m.parts)) return [];

    const texto = m.parts
      .filter((parte): parte is { type: 'text'; text: string } => {
        const p = parte as { type?: unknown; text?: unknown } | null;

        return p?.type === 'text' && typeof p.text === 'string';
      })
      .map((parte) => parte.text)
      .join('\n')
      .trim();

    return texto ? [texto] : [];
  });
}

/**
 * Lo que reemplaza al JSON del plan en el contexto cuando el plan está cerrado.
 *
 * No dice «no hay plan»: dice que lo hubo, que se terminó y que ya no manda. El
 * modelo igual ve la tarjeta vieja en la historia, y sin esto la seguiría
 * leyendo como pendiente.
 */
export const SECCION_DEL_PLAN_TERMINADO = `## The course plan is finished

The plan the teacher approved in this conversation was built in full (measured by the server, not by you). It is history now, not a specification: what counts is the course as it is TODAY and what the teacher asks for NOW.

- Never add, remove or rewrite an existing lesson, exercise or question to make it match that old plan. The teacher may have changed it on purpose after the build — in this conversation, in another one, or by hand in the editor.
- Do only what the teacher's latest message asks. If you think something from the old plan is missing, say so in one sentence and ask; do not build it.`;
