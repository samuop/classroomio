import { esRondaEnCurso, esTiempoAgotado } from './errores-del-chat';

/**
 * Qué hace el panel cuando una ronda del chat no termina limpia.
 *
 * ── Lo que pasaba ────────────────────────────────────────────────────────────
 *
 * El panel guardaba la conversación al final de cada ronda con lo que tuviera,
 * aunque la ronda se hubiera cortado. Medido: el stream se cortó a los 121 s
 * mientras el servidor escribía una lección; el panel guardó el mensaje con esa
 * herramienta «trabajando» y sin metadata, y el chat quedó congelado ahí para
 * siempre —girando, sin avance— aunque el servidor siguió y construyó ocho
 * piezas más que la conversación nunca mostró.
 *
 * ── Cómo es ahora (contrato con la API) ──────────────────────────────────────
 *
 * La ronda termina en el servidor aunque el navegador se vaya, y AHÍ se guarda
 * la conversación entera. Entonces, si la ronda no terminó limpia en el
 * navegador, el panel no guarda nada: cierra lo que quedó colgado para que no
 * gire, espera a que el servidor diga que la ronda ya no está viva
 * (`GET /agent/status` → `activeRound`) y recarga la conversación guardada.
 */

/** Cómo terminó una ronda, vista desde el navegador. */
export type FinDeRonda =
  /** Llegó hasta el final: se guarda como siempre. */
  | 'completa'
  /**
   * El stream se cortó desde el navegador. Con la orden de «Detener» entregada
   * el stream no se corta (la ronda cierra sola tras el paso en curso), así que
   * esto es la orden que no se pudo dejar: el servidor sigue hasta terminar y
   * guarda él. No se guarda nada a medias: se espera y se recarga.
   */
  | 'detenida'
  /** El stream ya había empezado y se cortó. El servidor sigue y guarda él. */
  | 'cortada'
  /** Falló antes de empezar, o el servidor la terminó con un error. */
  | 'fallida'
  /** El servidor la rechazó porque esa conversación ya tiene una ronda viva (409). */
  | 'rechazada';

export interface DatosDelFin {
  isAbort: boolean;
  isDisconnect: boolean;
  isError: boolean;
  /** Llega con la parte `finish`. Sin ella, el stream se cerró antes de tiempo. */
  finishReason?: string;
  /** Llegaron las cabeceras: el servidor aceptó el turno y la ronda arrancó. */
  respuestaIniciada: boolean;
  error?: unknown;
}

/**
 * La clasificación, con las señales que de verdad distinguen los casos.
 *
 * `isDisconnect` no alcanza para reconocer un corte: el SDK lo deduce del texto
 * del error, y cada navegador lo escribe distinto («network error», «Load
 * failed», «Error in body stream»). Lo que sí es igual en todos es si el corte
 * llegó DESPUÉS de las cabeceras: antes, el cliente de la API ya lo convirtió en
 * su propio error. Y un stream que se cierra sin la parte `finish` también es
 * un corte, aunque no traiga error: el SDK lo da por bueno sin avisar.
 */
export function clasificarFinDeRonda(datos: DatosDelFin): FinDeRonda {
  if (datos.isAbort) return 'detenida';

  if (datos.isError || datos.isDisconnect) {
    if (esRondaEnCurso(datos.error)) return 'rechazada';

    if (datos.respuestaIniciada && (datos.isDisconnect || datos.error instanceof TypeError)) return 'cortada';

    return 'fallida';
  }

  if (datos.respuestaIniciada && datos.finishReason == null) return 'cortada';

  return 'completa';
}

const ESTADOS_SIN_RESULTADO = new Set(['input-streaming', 'input-available']);

function esParteDeHerramienta(parte: { type?: unknown }): boolean {
  return typeof parte.type === 'string' && (parte.type.startsWith('tool-') || parte.type === 'dynamic-tool');
}

/**
 * Las herramientas que quedaron sin resultado, cerradas como interrumpidas.
 *
 * Una herramienta en `input-available` se dibuja trabajando, con el ícono
 * girando. Si la ronda ya terminó para este navegador, esa herramienta no va a
 * devolver nada por este stream nunca: dejarla así es el chat congelado. Cuando
 * el servidor termine la ronda y se recargue la conversación, lo que llegó a
 * guardarse reemplaza esto.
 *
 * Devuelve el mismo arreglo si no había nada que cerrar, para que quien llama
 * pueda no reasignar.
 */
export function cerrarHerramientasColgadas<M extends { role: string; parts: unknown[] }>(
  mensajes: M[],
  texto: string
): M[] {
  let hubo = false;

  const cerrados = mensajes.map((mensaje) => {
    if (mensaje.role !== 'assistant' || !Array.isArray(mensaje.parts)) return mensaje;

    let cambio = false;
    const partes = mensaje.parts.map((parte) => {
      const conEstado = parte as { type?: unknown; state?: unknown };

      if (!esParteDeHerramienta(conEstado) || !ESTADOS_SIN_RESULTADO.has(String(conEstado.state))) return parte;

      cambio = true;

      return { ...(parte as object), state: 'output-error', errorText: texto };
    });

    if (!cambio) return mensaje;

    hubo = true;

    return { ...mensaje, parts: partes } as M;
  });

  return hubo ? cerrados : mensajes;
}

/**
 * La conversación que queda después de esperar a que la ronda termine.
 *
 * El servidor guarda al terminar la ronda lo que el cliente le mandó más la
 * respuesta entera, con los MISMOS ids. Lo guardado reemplaza a la local sólo
 * si trae, DESPUÉS del último mensaje del docente, una respuesta del asistente
 * con algo adentro: ésa es la versión completa del turno.
 *
 * Que traiga el mensaje del docente no alcanza: el servidor lo guarda apenas
 * acepta el pedido, antes de trabajar. Tomar eso como «el turno completo»
 * borraba la banda de error y el «Reintentar» de una ronda que falló, y
 * reemplazaba por el pedido pelado la respuesta a medias que la pantalla ya
 * mostraba (un reinicio del servidor a mitad de ronda: lo construido quedaba en
 * el curso y desaparecía del chat). En esos casos se queda la local.
 */
export function conversacionTrasLaRonda<M extends { id: string; role: string; parts?: unknown[] }>(
  local: M[],
  servidor: M[] | null | undefined
): M[] {
  if (!servidor || servidor.length === 0) return local;

  let ultimoDelDocente: M | undefined;

  for (let indice = local.length - 1; indice >= 0; indice -= 1) {
    if (local[indice]?.role === 'user') {
      ultimoDelDocente = local[indice];
      break;
    }
  }

  if (!ultimoDelDocente) return servidor;

  const id = ultimoDelDocente.id;
  const posicion = servidor.findIndex((mensaje) => mensaje.id === id);

  if (posicion === -1) return local;

  const trajoRespuesta = servidor
    .slice(posicion + 1)
    .some((mensaje) => mensaje.role === 'assistant' && Array.isArray(mensaje.parts) && mensaje.parts.length > 0);

  return trajoRespuesta ? servidor : local;
}

/**
 * Si la copia local tiene una respuesta a medias que el servidor no guardó.
 *
 * Pasa cuando el servidor se reinicia a mitad de ronda (cada deploy): en la base
 * quedó sólo el pedido, y lo construido está en el curso y en la pantalla. Con
 * la ronda ya muerta nadie más va a guardar esa respuesta: si el panel no la
 * guarda, desaparece al recargar la página.
 */
export function laLocalTieneMasQueElServidor<M extends { id: string; role: string; parts?: unknown[] }>(
  local: M[],
  servidor: M[] | null | undefined
): boolean {
  let ultimo = -1;

  for (let indice = local.length - 1; indice >= 0; indice -= 1) {
    if (local[indice]?.role === 'user') {
      ultimo = indice;
      break;
    }
  }

  if (ultimo === -1) return false;

  const conPartes = (mensaje: M) => mensaje.role === 'assistant' && Array.isArray(mensaje.parts) && mensaje.parts.length > 0;

  if (!local.slice(ultimo + 1).some(conPartes)) return false;

  const enElServidor = (servidor ?? []).findIndex((mensaje) => mensaje.id === local[ultimo].id);

  return enElServidor === -1 || !(servidor ?? []).slice(enElServidor + 1).some(conPartes);
}

/**
 * Si la ronda pudo haber seguido en el servidor después de este fin, y hay que
 * esperarla y recargar lo que guarde.
 *
 * Un error con estado HTTP antes de las cabeceras (un 402, un 500) es una
 * respuesta del servidor: la ronda no arrancó o ya terminó, y no hay nada que
 * esperar. El vencimiento del reloj del navegador (408) no: el servidor siguió.
 */
export function hayQueEsperarAlServidor(fin: FinDeRonda, datos: { respuestaIniciada: boolean; error?: unknown }): boolean {
  if (fin === 'completa') return false;
  if (fin !== 'fallida') return true;

  return datos.respuestaIniciada || esTiempoAgotado(datos.error);
}

/**
 * Si la banda de error se puede sacar cuando la recarga trae el turno completo.
 *
 * Sólo cuando el error era del CAMINO y no de la ronda: el stream que se cortó
 * o el reloj del navegador que venció. Ahí el servidor terminó bien y el turno
 * completo es la respuesta. Un error de la ronda (el proveedor que falla a
 * mitad de camino) queda a la vista con su «Reintentar», aunque lo guardado
 * traiga lo que se llegó a hacer.
 */
export function laRecargaResuelveElError(fin: FinDeRonda, error: unknown): boolean {
  if (fin === 'cortada' || fin === 'detenida') return true;

  return fin === 'fallida' && esTiempoAgotado(error);
}

/** La ronda viva que informa `GET /agent/status`. */
export interface RondaViva {
  conversationId: string;
  startedAt: string;
}

/**
 * La ronda viva que trae un estado del agente, leída a la defensiva.
 *
 * Un estado que no informa el campo (una API anterior a él) cuenta como «no
 * hay»: sin ese dato no hay nada que esperar, y trabar el chat por las dudas
 * sería peor que no avisar.
 */
export function rondaVivaDe(estado: unknown): RondaViva | null {
  const ronda = (estado as { activeRound?: unknown } | null | undefined)?.activeRound;
  const posible = ronda as { conversationId?: unknown; startedAt?: unknown } | null | undefined;

  if (typeof posible?.conversationId !== 'string') return null;

  return { conversationId: posible.conversationId, startedAt: String(posible.startedAt ?? '') };
}

/** Cada cuánto se pregunta si la ronda sigue viva. */
export const INTERVALO_DE_ESPERA_MS = 4000;

/**
 * Hasta cuándo se espera. Una ronda larga dura minutos; esto es sólo para que
 * una espera nunca quede andando para siempre si algo no contesta.
 */
export const MAXIMO_DE_VUELTAS = 900;

export interface EsperaDeRonda {
  conversationId: string;
  /**
   * La ronda viva ahora: `null` si no hay ninguna, `undefined` si no se pudo
   * saber (un error de red). Sin saber, se sigue esperando sólo si ya se la
   * había visto viva: un chat no se traba por una ronda que nadie confirmó.
   */
  leerRondaViva: () => Promise<RondaViva | null | undefined>;
  /** Se llama cada vez que la ronda sigue viva, con el número de vuelta desde 1. */
  alSeguirViva?: (vuelta: number) => void;
  /** Cortar la espera: el panel se cerró, o el docente cambió de conversación. */
  cancelada?: () => boolean;
  dormir?: (ms: number) => Promise<void>;
  intervaloMs?: number;
  maximoDeVueltas?: number;
}

const dormirDeVerdad = (ms: number) => new Promise<void>((resolver) => setTimeout(resolver, ms));

/**
 * Espera a que la conversación deje de tener una ronda viva en el servidor.
 *
 * La primera pregunta sale enseguida: después de un pedido que falló antes de
 * llegar, no hay ronda y la espera termina sin demora.
 *
 * Devuelve `'terminada'` cuando la ronda ya no está (o se agotó la espera) y
 * `'cancelada'` si quien espera se fue.
 */
export async function esperarFinDeRonda(espera: EsperaDeRonda): Promise<'terminada' | 'cancelada'> {
  const dormir = espera.dormir ?? dormirDeVerdad;
  const intervalo = espera.intervaloMs ?? INTERVALO_DE_ESPERA_MS;
  const maximo = espera.maximoDeVueltas ?? MAXIMO_DE_VUELTAS;
  let vistaViva = false;

  for (let vuelta = 0; vuelta <= maximo; vuelta += 1) {
    if (vuelta > 0) await dormir(intervalo);

    if (espera.cancelada?.()) return 'cancelada';

    const ronda = await espera.leerRondaViva();

    if (espera.cancelada?.()) return 'cancelada';

    if (ronda === undefined) {
      if (!vistaViva) return 'terminada';
      continue;
    }

    if (ronda === null || ronda.conversationId !== espera.conversationId) return 'terminada';

    vistaViva = true;
    espera.alSeguirViva?.(vuelta + 1);
  }

  return 'terminada';
}
