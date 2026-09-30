/**
 * El chequeo de publicación sabe del plan aprobado.
 *
 * Medido en producción el 2026-09-30: con 6 de 20 piezas del plan construidas,
 * el constructor dio el curso por terminado y se fue a la portada. Llamó cinco
 * veces a `check_course_go_live_readiness`, que le contestaba «falta la imagen»
 * y nunca «faltan 14 piezas», y cerró la ronda con «el curso ha sido construido
 * en su totalidad». El panel siguió solo, porque el servidor mide el avance,
 * pero la docente leyó algo falso.
 *
 * El chequeo es donde el modelo va a ver si terminó: si el plan que está
 * construyendo tiene piezas que faltan, lo dice primero, con las que siguen,
 * medidas sobre el curso y no sobre la conversación.
 *
 * Sólo en una ronda que construye el plan (ver `progresoDelPlan` en
 * `buildAgentTools`). En una conversación vieja un ítem cuyo contenido la
 * docente borró a propósito cuenta como pendiente para siempre, y un «seguí
 * construyendo» ahí rehace lo que ella sacó —el mismo motivo por el que la
 * continuación automática del panel arranca apagada—.
 */
import type { CourseGoLiveReadiness } from '@api/services/course/go-live-readiness';

import type { PlanProgress } from './chat-context';

/** Cuántas de las piezas que faltan se nombran; el resto se cuenta. */
const PIEZAS_NOMBRADAS = 5;

/**
 * Lo que hay que construir. Una sección que existe figura «vacía» mientras le
 * falte alguna pieza, y esa pieza ya se nombra: nombrar también la sección
 * manda a llenar algo que no se llena directamente.
 */
function porConstruir(item: PlanProgress['items'][number]): boolean {
  return item.status === 'missing' || (item.status === 'empty' && item.kind !== 'section');
}

export function conElPlanPendiente(readiness: CourseGoLiveReadiness, progreso: PlanProgress | undefined): CourseGoLiveReadiness {
  const faltan = progreso?.items.filter(porConstruir) ?? [];
  if (!progreso || faltan.length === 0) return readiness;

  const siguientes = faltan
    .slice(0, PIEZAS_NOMBRADAS)
    .map((item) => `«${item.title}» (${item.kind}, ${item.status === 'empty' ? 'created but empty' : 'not created yet'})`);
  const resto = faltan.length > PIEZAS_NOMBRADAS ? `, and ${faltan.length - PIEZAS_NOMBRADAS} more` : '';

  return {
    ...readiness,
    ready: false,
    blockers: [
      {
        code: 'PLAN_INCOMPLETE',
        message: `The approved plan you are building is not finished: only ${progreso.completed} of its ${progreso.total} items are built (measured on the course, not taken from the conversation). Next: ${siguientes.join('; ')}${resto}. Keep building from the first one. The landing page and publishing come after the plan, and the course is not built until this blocker is gone.`,
        target: 'plan'
      },
      ...readiness.blockers
    ]
  };
}
