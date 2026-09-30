import { mensajeDeControl, type MensajeDeControl } from './mensajes-de-control';
import { planesDeLaConversacion } from './plan-summary';

/**
 * Cuándo un plan cuenta como aprobado.
 *
 * ── Lo que pasaba ────────────────────────────────────────────────────────────
 *
 * Alcanzaba con que existiera el mensaje de aprobación. Si ese pedido fallaba
 * —medido: un vencimiento a los 30 s, antes de que el servidor contestara nada—
 * el plan quedaba «Aprobado» con la tilde verde, sin construir nada, y el botón
 * «Aprobar y construir» desaparecía. Peor después de recargar: el error vive en
 * memoria, así que quedaba «Aprobado» con 0 % de avance, sin botón de aprobar,
 * sin «Continuar» y sin «Reintentar».
 *
 * ── La regla ─────────────────────────────────────────────────────────────────
 *
 * Una aprobación cuenta si tuvo respuesta: un mensaje del asistente después de
 * ella (o, lo que es lo mismo pero medido, uno que traiga `planProgress`). O si
 * es el último mensaje y el pedido está en vuelo: mientras el servidor arranca,
 * la pantalla ya dice «Construyendo» en vez de volver a ofrecer el botón.
 */

interface MensajeDelChat {
  id: string;
  role: string;
  parts?: unknown[];
  metadata?: unknown;
}

function esAprobacion(mensaje: MensajeDelChat): boolean {
  if (mensaje.role !== 'user') return false;

  const plan = (mensaje.metadata as { plan?: { action?: unknown } } | undefined)?.plan;

  return plan?.action === 'implement_course_plan';
}

function traeAvance(mensaje: MensajeDelChat): boolean {
  const avance = (mensaje.metadata as { planProgress?: { total?: unknown } } | undefined)?.planProgress;

  return typeof avance?.total === 'number' && avance.total > 0;
}

/**
 * Una respuesta del asistente de verdad: con algo adentro, o con avance medido.
 *
 * Un mensaje del asistente vacío es el que el SDK agrega al recibir el `start`
 * de una ronda que se cayó enseguida: no contesta nada.
 */
function esRespuesta(mensaje: MensajeDelChat): boolean {
  return mensaje.role === 'assistant' && ((mensaje.parts?.length ?? 0) > 0 || traeAvance(mensaje));
}

export interface AprobacionVigente {
  /** Dónde está el mensaje de aprobación en la conversación. */
  indice: number;
  /** El plan tal como se aprobó (con las ediciones del docente), si viajó. */
  payload: unknown;
}

/**
 * La aprobación que vale para el plan que empieza en `desde`, o `null`.
 *
 * Se recorre de la más nueva a la más vieja: si la última falló pero una
 * anterior tuvo respuesta —se aprobó, se construyó una parte, y un segundo
 * intento se cayó—, el plan sigue aprobado por la anterior.
 *
 * @param desde índice del mensaje que trajo el plan; sólo cuentan las
 *   aprobaciones posteriores.
 * @param enCurso hay un pedido en vuelo ahora mismo.
 */
export function aprobacionVigente(
  mensajes: MensajeDelChat[],
  desde: number,
  enCurso: boolean
): AprobacionVigente | null {
  for (let indice = mensajes.length - 1; indice > desde; indice -= 1) {
    const mensaje = mensajes[indice];

    if (!mensaje || !esAprobacion(mensaje)) continue;

    const respondida = mensajes.slice(indice + 1).some((posterior) => esRespuesta(posterior));
    const enVuelo = enCurso && indice === mensajes.length - 1;

    if (respondida || enVuelo) {
      const plan = (mensaje.metadata as { plan?: { payload?: unknown } }).plan;

      return { indice, payload: plan?.payload };
    }
  }

  return null;
}

/**
 * En qué anda el plan de la conversación, para decidir avisos fuera del chat.
 *
 * - `pendiente`: hay un plan propuesto y todavía no se aprobó.
 * - `construyendo`: se aprobó y el servidor todavía no lo midió completo.
 * - `terminado`: el último avance medido dice que está todo.
 * - `null`: la conversación no tiene plan.
 */
export type EstadoDelPlan = 'pendiente' | 'construyendo' | 'terminado' | null;

export function estadoDelPlan(mensajes: MensajeDelChat[], enCurso = false): EstadoDelPlan {
  const vigente = planesDeLaConversacion(mensajes).at(-1);

  if (!vigente) return null;

  const desde = mensajes.findIndex((mensaje) => mensaje.id === vigente.messageId);
  const aprobacion = aprobacionVigente(mensajes, desde, enCurso);

  if (!aprobacion) return 'pendiente';

  for (let indice = mensajes.length - 1; indice > aprobacion.indice; indice -= 1) {
    const avance = (mensajes[indice]?.metadata as { planProgress?: { total: number; completed: number } } | undefined)
      ?.planProgress;

    if (avance && avance.total > 0) return avance.completed >= avance.total ? 'terminado' : 'construyendo';
  }

  return 'construyendo';
}

export interface TurnoDelDocente {
  /** El mensaje del docente que abrió el último turno. */
  mensaje: MensajeDelChat;
  /** Si ese mensaje fue un gesto (aprobar, continuar) y no algo que escribió. */
  control: MensajeDeControl | null;
}

/**
 * El último turno que abrió el docente: lo que «Reintentar» tiene que volver a
 * pedir.
 *
 * Antes se reenviaba «el último texto escrito», que sólo se actualizaba al
 * escribir: después de aprobar el plan, reintentar mandaba como mensaje nuevo
 * la descripción original del curso. El turno que falló es el último mensaje
 * del docente, con su texto, sus partes y su metadata tal como quedaron.
 */
export function ultimoTurnoDelDocente(mensajes: MensajeDelChat[]): TurnoDelDocente | null {
  for (let indice = mensajes.length - 1; indice >= 0; indice -= 1) {
    const mensaje = mensajes[indice];

    if (mensaje?.role === 'user') return { mensaje, control: mensajeDeControl(mensaje) };
  }

  return null;
}
