/**
 * Cuándo el panel sigue construyendo solo, sin que el docente apriete nada.
 *
 * ── Para qué existe ──────────────────────────────────────────────────────────
 *
 * Un curso de cualquier tamaño necesita más pasos de los que entran en una
 * ronda, así que la ronda termina con `continuation` y el docente tenía que
 * apretar «Continuar» una y otra vez por un plan que ya había aprobado. Esto
 * dispara la ronda siguiente, con tres frenos, porque un bucle que gasta fichas
 * no puede poder desbocarse: tope de rondas, estancamiento medido por el
 * servidor, y Stop o error.
 *
 * ── Por qué arranca APAGADA ──────────────────────────────────────────────────
 *
 * Durante meses esto no se disparó nunca: el servidor no llegaba a mandar
 * `planProgress` (el valor se calculaba después de emitir la metadata). Al
 * arreglar eso, la función revive, y revive en un lugar donde no tiene que
 * actuar.
 *
 * El plan aprobado se detecta recorriendo TODA la historia de la conversación.
 * Y un ítem del plan cuyo contenido ya no existe cuenta como pendiente para
 * siempre. Entonces, en una conversación vieja donde el docente borró a
 * propósito una lección, cualquier pedido suelto —«editá el diagrama de la
 * lección 3»— termina con «plan incompleto», y si la continuación estuviera
 * encendida desde que se abre el panel, mandaría sola «seguí implementando el
 * plan» y reconstruiría lo que el docente borró. El freno por estancamiento no
 * lo ataja: reconstruir lo borrado SÍ es avance.
 *
 * Por eso sólo la encienden dos gestos explícitos de ESTA sesión: aprobar un
 * plan, o apretar «Continuar». Abrir el panel no. En una conversación vieja el
 * botón «Continuar» sigue apareciendo, que es la decisión del docente; lo único
 * que se pierde es que arranque sola.
 */

export const MAX_RONDAS_AUTOMATICAS = 12;

export interface FrenoDeContinuacion {
  habilitada: boolean;
  rondas: number;
  /** Lo completado cuando se disparó la última ronda automática. */
  avanceAnterior: number | null;
  /** El mensaje al que ya se respondió, para no disparar dos veces por el mismo. */
  respondidoA: string | null;
}

/** Al abrir el panel: apagada. Ver arriba por qué. */
export function frenoInicial(): FrenoDeContinuacion {
  return { habilitada: false, rondas: 0, avanceAnterior: null, respondidoA: null };
}

/** Al aprobar un plan: una construcción nueva, con los contadores en cero. */
export function frenoArmado(): FrenoDeContinuacion {
  return { habilitada: true, rondas: 0, avanceAnterior: null, respondidoA: null };
}

export interface MensajeParaContinuar {
  id: string;
  role: string;
  metadata?: {
    continuation?: unknown;
    planProgress?: { total: number; completed: number };
  };
}

export type DecisionDeContinuacion =
  | { tipo: 'esperar' }
  | { tipo: 'frenar' }
  | { tipo: 'continuar'; freno: FrenoDeContinuacion };

/**
 * Qué hacer con el último mensaje de la conversación.
 *
 * `frenar` apaga la continuación hasta el próximo gesto del docente; `esperar`
 * no cambia nada. Sólo decide sobre progreso MEDIDO por el servidor, nunca
 * sobre lo que el modelo dice que le falta.
 */
export function decidirContinuacion(
  freno: FrenoDeContinuacion,
  ultimo: MensajeParaContinuar | undefined,
  maxRondas = MAX_RONDAS_AUTOMATICAS
): DecisionDeContinuacion {
  if (!freno.habilitada) return { tipo: 'esperar' };
  if (!ultimo || ultimo.role !== 'assistant' || ultimo.id === freno.respondidoA) return { tipo: 'esperar' };
  if (!ultimo.metadata?.continuation) return { tipo: 'esperar' };

  // Verdad del servidor, y nada más. Sin progreso no hay plan en construcción.
  const progreso = ultimo.metadata.planProgress;
  if (!progreso || progreso.total === 0 || progreso.completed >= progreso.total) return { tipo: 'esperar' };

  if (freno.rondas >= maxRondas) return { tipo: 'frenar' };
  if (freno.avanceAnterior !== null && progreso.completed <= freno.avanceAnterior) return { tipo: 'frenar' };

  return {
    tipo: 'continuar',
    freno: {
      habilitada: true,
      rondas: freno.rondas + 1,
      avanceAnterior: progreso.completed,
      respondidoA: ultimo.id
    }
  };
}
