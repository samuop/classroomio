import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  generateId,
  type UIMessage,
  type UIMessageChunk,
  type UIMessageStreamOptions
} from 'ai';
import type { RedisClient } from '@api/utils/redis/redis';

/**
 * La ronda del chat vista desde el servidor: una sola viva por conversación,
 * con latido mientras trabaja, y que termina aunque el navegador se vaya.
 *
 * ── Lo que se midió (2026-09-29) ─────────────────────────────────────────────
 *
 * 1. Una ronda de construcción se cortó a los 121 s de silencio mientras
 *    `write_lesson` trabajaba (155 s entre el escritor, el rebote y dos
 *    chequeos de fundamento lentos). La respuesta no mandaba un byte mientras
 *    corría una herramienta, y el proxy de adelante corta a los 120 s sin datos.
 *    La docente vio «Error de red», y el problema no era su conexión.
 * 2. Cortada la conexión, la ronda no terminaba ni se cancelaba. La respuesta
 *    leía una rama de un `tee` del stream interno; cancelada esa rama, nadie
 *    más tiraba del stream y el bucle quedaba colgado entre dos pasos. La
 *    herramienta en vuelo guardaba igual, pero `onFinish` no corría: ni el
 *    consumo quedaba registrado ni la conversación guardada, y el chat se
 *    quedaba para siempre en «escribiendo la lección 1.1».
 * 3. Nada impedía dos rondas a la vez sobre la misma conversación: un reintento
 *    arrancó mientras la ronda anterior todavía estaba escribiendo.
 *
 * ── Qué hace esto ────────────────────────────────────────────────────────────
 *
 * - Latido: cada `LATIDO_MS` una parte transitoria `data-latido`, que el
 *   cliente no guarda en el mensaje. Ningún tramo del camino ve una respuesta
 *   callada más que eso (el proxy corta a los 120 s y Cloudflare a los 100).
 * - La ronda la lee el SERVIDOR hasta el final. Lo que recibe el navegador es
 *   una copia: si se va, las partes se descartan y la ronda sigue. Es la
 *   decisión del dueño: si la docente cambia de empresa o cierra la pestaña, la
 *   ronda termina sola, se guarda y se cobra.
 * - Al terminar se guarda la conversación entera —lo que mandó el cliente más
 *   la respuesta completa con su metadata— con el MISMO id de mensaje que el
 *   cliente recibió en la parte `start`. Así el cliente que perdió el stream
 *   puede esperar a que la ronda muera y recargar la conversación del servidor.
 * - Un candado por conversación en Redis, con token: mientras la ronda vive,
 *   otro pedido sobre la misma conversación recibe 409. Se renueva solo y se
 *   suelta al final comparando el token, así una ronda vieja nunca suelta el
 *   candado de otra.
 * - «Detener» es otra cosa que irse: una orden propia (`pedirQueSeDetenga`)
 *   que deja una marca junto al candado, con el token de la ronda viva. Entre
 *   un paso y el siguiente la ronda la mira (`pidieronDetener`) y no arranca
 *   el siguiente: lo que estaba haciendo termina y se guarda, y la ronda cierra
 *   normal. Atada al token, una marca que llega tarde no frena a la ronda que
 *   venga después.
 */

/** Cada cuánto late la ronda: muy por debajo de los 100 s de Cloudflare. */
export const LATIDO_MS = 20_000;

/**
 * Cuánto dura el candado sin renovarse.
 *
 * Tres latidos: un proceso que muere no deja la conversación trabada más de un
 * minuto, y una renovación que se atrasa un poco no lo suelta.
 */
export const CANDADO_MS = 60_000;

/** El cuerpo del 409 cuando la conversación ya tiene una ronda viva. */
export const RONDA_EN_CURSO = {
  success: false as const,
  error: 'A round is already running for this conversation',
  code: 'AGENT_ROUND_IN_PROGRESS' as const
};

/** La ronda viva de una persona en un curso, como la ve `GET /agent/status`. */
export interface RondaViva {
  conversationId: string;
  startedAt: string;
}

export interface CandadoDeRonda {
  readonly conversationId: string;
  readonly startedAt: string;
  /** Extiende el candado, sólo si sigue siendo de esta ronda. */
  renovar(): Promise<void>;
  /** Lo suelta, sólo si sigue siendo de esta ronda. Llamarlo dos veces no hace nada. */
  soltar(): Promise<void>;
  /**
   * Si la docente tocó «Detener» para ESTA ronda. Sin Redis, `false`: la ronda
   * sigue hasta su final, como cuando la docente se va.
   */
  pidieronDetener(): Promise<boolean>;
}

export function claveDelCandado(conversationId: string): string {
  return `agent:round:conversation:${conversationId}`;
}

/** La marca de «Detener» de la ronda viva de una conversación. Vale el token de esa ronda. */
export function claveDeDetener(conversationId: string): string {
  return `agent:round:stop:${conversationId}`;
}

/**
 * Las rondas vivas de una persona en un curso: conversación → cuándo empezó.
 *
 * Existe para que `GET /agent/status` conteste sin barrer Redis. Puede quedar
 * una entrada vieja si un proceso murió; por eso quien lee confirma cada una
 * contra su candado antes de creerle.
 */
export function claveDelIndice(courseId: string, userId: string): string {
  return `agent:round:course:${courseId}:user:${userId}`;
}

/**
 * Renovar sólo si el candado sigue siendo nuestro.
 *
 * En un script porque «mirar y extender» en dos comandos deja una ventana: el
 * candado vence entre uno y otro, otra ronda lo toma, y extenderíamos el suyo.
 *
 * La marca de «Detener» (KEYS[3]) se renueva con el candado: el paso en curso
 * puede tardar más que un vencimiento (una lección llegó a 155 s) y la marca
 * tiene que seguir ahí cuando ese paso termine.
 */
export const RENOVAR_SI_ES_MIO = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  redis.call('PEXPIRE', KEYS[1], ARGV[2])
  redis.call('HSET', KEYS[2], ARGV[3], ARGV[4])
  redis.call('PEXPIRE', KEYS[2], ARGV[2])
  if redis.call('GET', KEYS[3]) == ARGV[1] then
    redis.call('PEXPIRE', KEYS[3], ARGV[2])
  end
  return 1
end
return 0`;

/** Soltar sólo si el candado sigue siendo nuestro. Mismo motivo que arriba. */
export const SOLTAR_SI_ES_MIO = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  redis.call('DEL', KEYS[1])
  redis.call('HDEL', KEYS[2], ARGV[2])
  if redis.call('GET', KEYS[3]) == ARGV[1] then
    redis.call('DEL', KEYS[3])
  end
  return 1
end
return 0`;

/**
 * Marcar «Detener» para la ronda que tiene el candado AHORA.
 *
 * La marca vale el token de esa ronda: si llega cuando la ronda ya terminó no
 * se escribe nada, y si la ronda siguiente arranca antes de que venza no la
 * reconoce como suya. En un script por lo mismo que los de arriba.
 */
export const PEDIR_DETENER = `
local token = redis.call('GET', KEYS[1])
if token then
  redis.call('SET', KEYS[2], token, 'PX', ARGV[1])
  return 1
end
return 0`;

/**
 * Cuánto se espera a Redis para soltar el candado antes de cerrar la respuesta.
 *
 * El candado se suelta ANTES de que el navegador vea terminar el stream, porque
 * la continuación automática manda el pedido siguiente apenas termina: si el
 * candado siguiera tomado, ese pedido rebotaría con 409. Pero un Redis lento no
 * puede dejar la respuesta abierta: pasado este tope se cierra igual, y el
 * candado vence solo en `CANDADO_MS`.
 */
const TOPE_PARA_SOLTAR_MS = 3_000;

/**
 * Si Redis puede contestar YA.
 *
 * `isReady` y no `isOpen`: mientras el cliente se reconecta `isOpen` sigue en
 * `true` y los comandos se encolan hasta que vuelva la conexión. Para el
 * candado eso sería colgar el pedido del chat —o el cierre de la respuesta—
 * detrás de un Redis caído, en vez de fallar abierto.
 */
function redisDisponible(redis: RedisClient): boolean {
  return redis.isReady;
}

/**
 * Un candado que no traba nada: lo que se usa cuando Redis no está.
 *
 * Falla abierto, como el limitador de pedidos: sin Redis el chat anda como
 * antes de que existiera el candado, y queda el aviso en el log.
 */
function candadoLibre(conversationId: string, startedAt: string): CandadoDeRonda {
  return {
    conversationId,
    startedAt,
    renovar: async () => {},
    soltar: async () => {},
    pidieronDetener: async () => false
  };
}

/**
 * Toma el candado de la conversación para esta ronda.
 *
 * Devuelve `null` cuando ya hay otra ronda viva —quien llama responde 409— y
 * un candado que se renueva solo cada `renovarCadaMs` hasta que se lo suelta.
 * Se renueva desde que se toma y no desde que arranca el stream: el trabajo
 * previo (armar el índice de fuentes, por ejemplo) puede tardar más de un
 * minuto, y un candado que vence en ese tramo deja pasar el reintento.
 */
export async function tomarCandadoDeRonda(params: {
  redis: RedisClient;
  conversationId: string;
  courseId: string;
  userId: string;
  ttlMs?: number;
  renovarCadaMs?: number;
  ahora?: () => Date;
}): Promise<CandadoDeRonda | null> {
  const { redis, conversationId, courseId, userId } = params;
  const ttlMs = params.ttlMs ?? CANDADO_MS;
  const renovarCadaMs = params.renovarCadaMs ?? LATIDO_MS;
  const startedAt = (params.ahora ?? (() => new Date()))().toISOString();
  const clave = claveDelCandado(conversationId);
  const indice = claveDelIndice(courseId, userId);
  const marcaDeDetener = claveDeDetener(conversationId);
  const token = generateId();

  if (!redisDisponible(redis)) {
    console.warn(`[agent.chat] sin candado de ronda para ${conversationId}: Redis no está disponible`);
    return candadoLibre(conversationId, startedAt);
  }

  try {
    const tomado = await redis.set(clave, token, { NX: true, PX: ttlMs });

    if (tomado !== 'OK') return null;
  } catch (error) {
    console.warn(`[agent.chat] sin candado de ronda para ${conversationId}: Redis falló`, error);
    return candadoLibre(conversationId, startedAt);
  }

  try {
    await redis.hSet(indice, conversationId, startedAt);
    await redis.pExpire(indice, ttlMs);
  } catch (error) {
    // Sin el índice, `/agent/status` no ve esta ronda; el candado igual traba.
    console.warn('[agent.chat] no se pudo anotar la ronda viva en el índice:', error);
  }

  let soltado = false;
  let avisadoQueLoPerdio = false;

  const renovar = async (): Promise<void> => {
    // Sin conexión no se renueva: el comando quedaría encolado hasta que Redis
    // vuelva. El candado vence solo y la ronda sigue trabajando igual.
    if (soltado || !redisDisponible(redis)) return;

    try {
      const resultado = await redis.eval(RENOVAR_SI_ES_MIO, {
        keys: [clave, indice, marcaDeDetener],
        arguments: [token, String(ttlMs), conversationId, startedAt]
      });

      if (Number(resultado) !== 1 && !avisadoQueLoPerdio) {
        avisadoQueLoPerdio = true;
        console.warn(
          `[agent.chat] la ronda de ${conversationId} perdió su candado (venció sin renovarse); sigue trabajando igual`
        );
      }
    } catch (error) {
      console.warn(`[agent.chat] no se pudo renovar el candado de ${conversationId}:`, error);
    }
  };

  const renovacion = setInterval(() => void renovar(), renovarCadaMs);
  // Un candado pendiente no tiene que mantener vivo al proceso.
  renovacion.unref?.();

  return {
    conversationId,
    startedAt,
    renovar,
    pidieronDetener: async () => {
      // Sin conexión no se pregunta: el comando quedaría encolado y colgaría el
      // paso siguiente. Falla abierta: la ronda sigue, como si nadie lo pidiera.
      if (soltado || !redisDisponible(redis)) return false;

      try {
        return (await redis.get(marcaDeDetener)) === token;
      } catch (error) {
        console.warn(`[agent.chat] no se pudo leer la marca de «Detener» de ${conversationId}:`, error);
        return false;
      }
    },
    soltar: async () => {
      if (soltado) return;
      soltado = true;
      clearInterval(renovacion);

      // En todos los casos en que no se suelta, el candado vence solo en `ttlMs`.
      if (!redisDisponible(redis)) {
        console.warn(`[agent.chat] no se pudo soltar el candado de ${conversationId}: Redis no está disponible`);
        return;
      }

      const soltando = redis
        .eval(SOLTAR_SI_ES_MIO, { keys: [clave, indice, marcaDeDetener], arguments: [token, conversationId] })
        .then(() => 'soltado' as const)
        .catch((error: unknown) => {
          console.warn(`[agent.chat] no se pudo soltar el candado de ${conversationId}:`, error);
          return 'fallo' as const;
        });

      let tope: ReturnType<typeof setTimeout> | undefined;
      const vencido = new Promise<'vencido'>((resolver) => {
        tope = setTimeout(() => resolver('vencido'), TOPE_PARA_SOLTAR_MS);
      });

      const resultado = await Promise.race([soltando, vencido]);
      clearTimeout(tope);

      if (resultado === 'vencido') {
        console.warn(`[agent.chat] Redis tardó en soltar el candado de ${conversationId}; la respuesta se cierra igual`);
      }
    }
  };
}

/** Qué pasó con un pedido de «Detener». */
export type PedidoDeDetener =
  /** La marca quedó puesta: la ronda termina el paso en curso y cierra. */
  | 'pedido'
  /** No hay ronda viva en esa conversación: ya había terminado. */
  | 'sin-ronda'
  /** Sin Redis no hay dónde dejar la marca: la ronda sigue hasta su final. */
  | 'sin-redis';

/**
 * La orden de «Detener» de la docente para la ronda viva de una conversación.
 *
 * Quien llama ya comprobó que la conversación es de quien lo pide. Falla
 * abierta, como el candado: sin Redis devuelve `'sin-redis'` y la pantalla
 * avisa que la ronda va a seguir hasta terminar.
 */
export async function pedirQueSeDetenga(params: {
  redis: RedisClient;
  conversationId: string;
  ttlMs?: number;
}): Promise<PedidoDeDetener> {
  const { redis, conversationId } = params;

  if (!redisDisponible(redis)) {
    console.warn(`[agent.chat] «Detener» sin efecto para ${conversationId}: Redis no está disponible`);
    return 'sin-redis';
  }

  try {
    const resultado = await redis.eval(PEDIR_DETENER, {
      keys: [claveDelCandado(conversationId), claveDeDetener(conversationId)],
      arguments: [String(params.ttlMs ?? CANDADO_MS)]
    });

    return Number(resultado) === 1 ? 'pedido' : 'sin-ronda';
  } catch (error) {
    console.warn(`[agent.chat] «Detener» sin efecto para ${conversationId}: Redis falló`, error);
    return 'sin-redis';
  }
}

/**
 * La ronda viva de esta persona en este curso, o `null`.
 *
 * Con `conversationId`, la de esa conversación y ninguna otra: el panel que
 * espera su ronda no puede darla por terminada porque la más nueva del curso
 * sea de otro chat. Sin él, si hay más de una (dos pestañas, dos
 * conversaciones), la más nueva. Cada entrada del índice se confirma contra su
 * candado: el índice puede tener restos de un proceso que murió, el candado no
 * miente porque vence solo.
 */
export async function leerRondaViva(params: {
  redis: RedisClient;
  courseId: string;
  userId: string;
  conversationId?: string;
}): Promise<RondaViva | null> {
  const { redis } = params;

  if (!redisDisponible(redis)) return null;

  try {
    const indice = await redis.hGetAll(claveDelIndice(params.courseId, params.userId));
    const vivas: RondaViva[] = [];

    for (const [conversationId, startedAt] of Object.entries(indice ?? {})) {
      if (params.conversationId && conversationId !== params.conversationId) continue;

      if ((await redis.get(claveDelCandado(conversationId))) !== null) {
        vivas.push({ conversationId, startedAt });
      }
    }

    vivas.sort((a, b) => b.startedAt.localeCompare(a.startedAt));

    return vivas[0] ?? null;
  } catch (error) {
    console.warn('[agent.chat] no se pudo leer la ronda viva:', error);
    return null;
  }
}

/** Lo que dice una herramienta que quedó sin resultado cuando la ronda ya terminó. */
export const HERRAMIENTA_SIN_TERMINAR =
  'Se cortó antes de terminar. Revisá el curso: lo que llegó a guardarse quedó guardado.';

const ESTADOS_SIN_RESULTADO = new Set(['input-streaming', 'input-available']);

function esParteDeHerramienta(parte: { type?: unknown }): boolean {
  return typeof parte.type === 'string' && (parte.type.startsWith('tool-') || parte.type === 'dynamic-tool');
}

/**
 * Cierra las herramientas que quedaron sin resultado, antes de guardar.
 *
 * Cuando esto corre la ronda ya terminó en el servidor, y con el candado no
 * puede haber otra corriendo sobre la misma conversación: una herramienta que
 * sigue «pidiendo datos» o «trabajando» no va a devolver nada nunca. Guardada
 * así, el panel la dibuja girando para siempre —el chat congelado en
 * «escribiendo la lección 1.1» que se midió—. Se cierran también las de rondas
 * viejas que el navegador guardó cortadas antes de este arreglo.
 */
export function cerrarHerramientasColgadas<M extends UIMessage>(mensajes: M[]): M[] {
  return mensajes.map((mensaje) => {
    if (mensaje.role !== 'assistant' || !Array.isArray(mensaje.parts)) return mensaje;

    let cambio = false;
    const partes = mensaje.parts.map((parte) => {
      const conEstado = parte as { type?: unknown; state?: unknown };

      if (!esParteDeHerramienta(conEstado) || !ESTADOS_SIN_RESULTADO.has(String(conEstado.state))) return parte;

      cambio = true;

      return { ...parte, state: 'output-error', errorText: HERRAMIENTA_SIN_TERMINAR } as typeof parte;
    });

    return cambio ? { ...mensaje, parts: partes } : mensaje;
  });
}

/**
 * Lo mínimo que esto necesita del resultado de `streamText`.
 *
 * Estructural para que el test pase un `streamText` de verdad con un modelo
 * simulado, igual que la ruta.
 */
export interface ResultadoDeLaRonda {
  toUIMessageStream(opciones?: UIMessageStreamOptions<UIMessage>): ReadableStream<UIMessageChunk>;
}

/**
 * La respuesta HTTP de una ronda: con latido, leída hasta el final por el
 * servidor, guardada al terminar y con el candado soltado recién después.
 *
 * El orden del final importa y es éste: el `onFinish` de `streamText` (consumo,
 * logs) corre antes de que la rama que se lee acá se cierre; después se guarda
 * la conversación; después se suelta el candado. Quien espera a que la ronda
 * deje de estar viva para recargar la conversación encuentra lo guardado.
 */
export function responderRonda(params: {
  resultado: ResultadoDeLaRonda;
  /** Los mensajes que mandó el cliente en este pedido. */
  mensajesOriginales: UIMessage[];
  onError: (error: unknown) => string;
  messageMetadata: UIMessageStreamOptions<UIMessage>['messageMetadata'];
  /**
   * Guarda la conversación entera al terminar. Ausente cuando la ronda no
   * tiene conversación todavía (el primer mensaje de un chat nuevo): ahí la
   * crea y la guarda el cliente.
   */
  guardar?: (mensajes: UIMessage[]) => Promise<void>;
  candado?: CandadoDeRonda;
  latidoMs?: number;
  /** Para los logs: de qué conversación es la ronda. */
  etiqueta?: string;
}): Response {
  const etiqueta = params.etiqueta ?? 'sin conversación';
  const latidoMs = params.latidoMs ?? LATIDO_MS;
  let clienteSeFue = false;
  // Si el guardado del final ya se intentó. Sale bien o mal, no se repite.
  let guardadoIntentado = false;

  const guardar = async (mensajes: UIMessage[]): Promise<void> => {
    if (!params.guardar) return;

    guardadoIntentado = true;

    try {
      await params.guardar(cerrarHerramientasColgadas(mensajes));

      if (clienteSeFue) {
        console.log(`[agent.chat] ronda terminada sin cliente; conversación ${etiqueta} guardada por el servidor`);
      }
    } catch (error) {
      console.error(`[agent.chat] no se pudo guardar la conversación ${etiqueta} al terminar la ronda:`, error);
    }
  };

  const deLaRonda = params.resultado.toUIMessageStream({
    // Con los mensajes originales y un generador, la parte `start` lleva el id
    // del mensaje de la respuesta: el mismo con el que se guarda abajo.
    originalMessages: params.mensajesOriginales,
    generateMessageId: generateId,
    onError: params.onError,
    messageMetadata: params.messageMetadata,
    onEnd: async ({ messages, responseMessage, isContinuation }) => {
      // Una respuesta sin ninguna parte es una ronda que falló antes de
      // escribir nada (el proveedor no contestó, por ejemplo). Guardarla
      // dejaría una burbuja vacía en la conversación: se guarda lo que mandó
      // el cliente, que es lo que el cliente guardaba antes en ese caso.
      const sinRespuesta = !isContinuation && responseMessage.parts.length === 0;

      await guardar(sinRespuesta ? params.mensajesOriginales : messages);
    }
  });

  const stream = createUIMessageStream({
    onError: params.onError,
    execute: async ({ writer }) => {
      const latido = setInterval(() => {
        // Transitoria: el cliente la recibe pero no la guarda en el mensaje.
        writer.write({ type: 'data-latido', data: {}, transient: true });
      }, latidoMs);

      try {
        // Leída ACÁ hasta el final, pase lo que pase con el navegador. Si se
        // fue, `writer.write` descarta la parte en silencio y el bucle sigue:
        // es lo que hace que la ronda termine, se cobre y se guarde.
        const lector = deLaRonda.getReader();

        while (true) {
          const { done, value } = await lector.read();

          if (done) break;

          writer.write(value);
        }
      } finally {
        clearInterval(latido);

        // El stream de la ronda se rompió antes de su final (un error interno,
        // no uno del modelo: esos llegan como partes). El cliente que perdió la
        // ronda recarga la conversación del servidor al ver que terminó, así
        // que al menos tiene que estar lo que mandó: si no, su último mensaje
        // desaparecería de la pantalla.
        if (!guardadoIntentado) await guardar(params.mensajesOriginales);

        await params.candado?.soltar();
      }
    }
  });

  return createUIMessageStreamResponse({
    stream: avisarSiElClienteSeVa(stream, () => {
      clienteSeFue = true;
      console.warn(`[agent.chat] el cliente cortó la ronda de ${etiqueta}; sigue en el servidor hasta terminar`);
    })
  });
}

/**
 * Una copia del stream que avisa cuando quien la lee la cancela.
 *
 * Con un `ReadableStream` propio y no con el `cancel` de un `TransformStream`,
 * que Node 20 todavía no llama.
 */
function avisarSiElClienteSeVa<T>(stream: ReadableStream<T>, alIrse: () => void): ReadableStream<T> {
  const lector = stream.getReader();

  return new ReadableStream<T>({
    async pull(controller) {
      const { done, value } = await lector.read();

      if (done) controller.close();
      else controller.enqueue(value);
    },
    async cancel(motivo) {
      alIrse();
      await lector.cancel(motivo);
    }
  });
}
