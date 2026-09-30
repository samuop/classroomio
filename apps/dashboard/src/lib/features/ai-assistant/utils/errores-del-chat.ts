import { MENSAJE_DE_TIEMPO_AGOTADO } from '$lib/utils/services/api/intentos';
import { tryParseApiErrorBody } from '$lib/utils/services/api/parse-api-error-body';

/**
 * Qué texto ve la docente cuando algo del asistente falla.
 *
 * ── Lo que pasaba ────────────────────────────────────────────────────────────
 *
 * El texto técnico del error llegaba tal cual a la pantalla. Un vencimiento
 * mostraba «Request timeout», en inglés y sin decir que el pedido seguía
 * corriendo en el servidor; la traducción que existía («No se pudo investigar
 * el tema.») perdía contra el texto crudo. Y un corte del stream a mitad de
 * ronda se mostraba como «Error de red. Revisá tu conexión…», que culpa a la
 * conexión de la docente cuando el corte fue del camino al servidor.
 *
 * Todo lo que decide el texto vive acá, sin pantalla, para poder probarlo.
 */

/** El código que manda la API cuando la conversación ya tiene una ronda viva (409). */
export const CODIGO_RONDA_EN_CURSO = 'AGENT_ROUND_IN_PROGRESS';

export interface ErrorDeApi {
  status?: number;
  /** El `code` del cuerpo `{ success: false, error, code }`, si vino. */
  code?: string;
  /** El `error` de ese cuerpo: el texto del servidor. */
  detalle?: string;
}

/**
 * Lo que se puede leer de un error de la API.
 *
 * El cliente de la API tira su `ApiError` con el estado HTTP y, para un 4xx,
 * con el cuerpo de la respuesta como mensaje: de ahí sale el `code`.
 */
export function leerErrorDeApi(error: unknown): ErrorDeApi {
  if (!error || typeof error !== 'object') return {};

  const status = (error as { status?: unknown }).status;
  const mensaje = (error as { message?: unknown }).message;
  const cuerpo = typeof mensaje === 'string' ? tryParseApiErrorBody(mensaje) : null;

  return {
    ...(typeof status === 'number' ? { status } : {}),
    ...(cuerpo ? { code: cuerpo.code, detalle: cuerpo.error } : {})
  };
}

/** La conversación ya tiene una ronda viva: el pedido se rechazó sin empezar. */
export function esRondaEnCurso(error: unknown): boolean {
  return leerErrorDeApi(error).code === CODIGO_RONDA_EN_CURSO;
}

/** Venció el reloj del navegador esperando las cabeceras. El servidor puede seguir. */
export function esTiempoAgotado(error: unknown): boolean {
  if (leerErrorDeApi(error).status === 408) return true;

  const mensaje = error && typeof error === 'object' ? (error as { message?: unknown }).message : error;

  return mensaje === MENSAJE_DE_TIEMPO_AGOTADO;
}

export type MensajeDeError =
  | { clave: string; valores?: Record<string, string | number> }
  | { texto: string };

/**
 * El mensaje de la banda de error del chat.
 *
 * @param corte el stream ya había empezado y se cortó: la ronda sigue en el
 *   servidor y lo creado quedó guardado. Gana sobre cualquier otro texto,
 *   porque el error que lo acompaña (un `TypeError` de red) es justamente el
 *   que culpaba a la conexión de la docente.
 */
export function mensajeDelErrorDelChat(error: unknown, opciones: { corte?: boolean } = {}): MensajeDeError | null {
  if (opciones.corte) return { clave: 'ai_assistant.error_stream_cut' };

  if (!error) return null;

  if (esRondaEnCurso(error)) return { clave: 'ai_assistant.error_round_in_progress' };
  // El del chat, no el de la investigación: acá el panel ya espera solo a que
  // la ronda termine en el servidor y esconde «Reintentar», así que «probá de
  // nuevo en unos segundos» contradecía lo que la pantalla estaba haciendo.
  if (esTiempoAgotado(error)) return { clave: 'ai_assistant.error_timeout_chat' };

  const { detalle } = leerErrorDeApi(error);
  const crudo = (error as { message?: unknown }).message;
  const mensaje = detalle ?? (typeof crudo === 'string' ? crudo : String(error));
  const minusculas = mensaje.toLowerCase();

  if (minusculas.includes('quota exceeded') || minusculas.includes('rate limit')) {
    const espera = mensaje.match(/retry in (\d+(?:\.\d+)?)/i);
    const segundos = espera ? Math.ceil(parseFloat(espera[1])) : null;

    return segundos
      ? { clave: 'ai_assistant.error_rate_limit_with_wait', valores: { seconds: segundos } }
      : { clave: 'ai_assistant.error_rate_limit' };
  }

  if (minusculas.includes('context length') || minusculas.includes('too long')) {
    return { clave: 'ai_assistant.error_context_too_long' };
  }

  if (minusculas.includes('network') || minusculas.includes('connection')) {
    return { clave: 'ai_assistant.error_network' };
  }

  return { texto: mensaje };
}

/**
 * La clave del texto para un error al agregar o releer una fuente.
 *
 * Los códigos son del contrato de la API (422): una página detrás de un
 * inicio de sesión —una planilla de Google privada entraba como fuente con el
 * texto de la pantalla de login—, una página sin texto útil, y un curso que ya
 * llegó a su tope de fuentes.
 *
 * @param errorCrudo lo que dejó la llamada en `error`: el cuerpo de la
 *   respuesta como texto, o el mensaje del vencimiento.
 */
export function claveDelErrorDeFuente(errorCrudo: string | null | undefined, porDefecto: string): string {
  const cuerpo = tryParseApiErrorBody(errorCrudo);

  if (cuerpo?.code === 'SOURCE_NEEDS_LOGIN') return 'course.sources.error_needs_login';
  if (cuerpo?.code === 'SOURCE_UNREADABLE') return 'course.sources.error_unreadable';
  // El curso ya tiene todas las fuentes que puede tener: ninguna se borra sola
  // para hacerle lugar a otra, lo decide la docente.
  if (cuerpo?.code === 'SOURCE_LIMIT_REACHED') return 'course.sources.error_source_limit';
  if (errorCrudo === MENSAJE_DE_TIEMPO_AGOTADO) return 'ai_assistant.error_timeout';

  return porDefecto;
}
