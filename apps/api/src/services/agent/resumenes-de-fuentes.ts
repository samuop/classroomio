import { getCourseOrganizationId } from '@cio/db/queries/tag';
import { duenoDeFuente } from '@cio/db/queries/agent/fuentes-del-curso';
import {
  MAX_DOCUMENT_SUMMARY_INPUT_CHARS,
  resumirDocumento,
  type ResumenDeDocumento
} from '@api/services/agent/summarize';
import { recordTokenUsage } from '@api/services/agent/usage';
import type { RedisClient } from '@api/utils/redis/redis';

/**
 * Los resúmenes de las fuentes, fuera del camino del chat.
 *
 * ── Qué pasaba ───────────────────────────────────────────────────────────────
 *
 * El índice de fuentes resumía cada fuente con el modelo ANTES de contestar, de
 * a una. Medido en producción: 11 fuentes, 38 s sin mandar ni las cabeceras, y
 * el navegador se fue a los 30 con «Request timeout» justo al aprobar el plan.
 * Otra docente, 7 fuentes, 31 s, el mismo error. Y como el resumen vivía una
 * hora en Redis, volvía a pasar en el primer turno de cada hora.
 *
 * ── Cómo es ahora ────────────────────────────────────────────────────────────
 *
 * Nadie espera un resumen. El índice lee en un solo viaje los que ya existen, y
 * para los que faltan pone las primeras letras de la fuente y pide el resumen
 * acá, en segundo plano. También se piden al crear una fuente, así que casi
 * siempre ya están cuando el índice los busca.
 *
 *   - Una cola en memoria con 4 lugares: once fuentes nuevas son once llamadas,
 *     pero no once a la vez.
 *   - Un candado por documento en Redis (SET NX): dos turnos o dos procesos que
 *     piden el mismo resumen no lo pagan dos veces. Medido: el reintento de las
 *     15:50 resumió de nuevo 4 fuentes que el pedido abandonado estaba
 *     resumiendo al mismo tiempo.
 *   - La clave lleva el hash del texto, así que el resumen dura 30 días y se
 *     invalida solo cuando la fuente cambia: un resumen que describe con
 *     seguridad un contenido que ya no está es peor que no tener ninguno.
 *   - Se cobra. Era una llamada al proveedor que no dejaba rastro en el consumo.
 *
 * Nada de acá puede romper un turno: los errores se anotan en el log y el
 * resumen se vuelve a pedir la próxima vez que haga falta.
 */

/** Cuánto dura un resumen. El texto no cambia sin cambiar el hash de la clave. */
export const TTL_RESUMEN_SEC = 30 * 24 * 3600;

/**
 * Cuánto dura el candado de un resumen en curso. Un resumen tarda unos 4 s; el
 * candado alcanza de sobra y, si la llamada falla, vence solo y el próximo
 * pedido lo reintenta sin quedar trabado.
 */
const TTL_CANDADO_SEC = 120;

/** Resúmenes a la vez, por proceso. */
export const RESUMENES_A_LA_VEZ = 4;

/** Tope de la cola: un techo contra un crecimiento sin fin, no un número que se espere tocar. */
const MAX_EN_COLA = 500;

/** Lo que el hash aporta a la clave; 16 caracteres hexadecimales sobran para distinguir versiones. */
function huella(contentHash: string): string {
  return contentHash.slice(0, 16);
}

export function claveDeResumen(documentId: string, contentHash: string): string {
  return `agent:source-summary:${documentId}:${huella(contentHash)}`;
}

function claveDeCandado(documentId: string, contentHash: string): string {
  return `agent:source-summary:lock:${documentId}:${huella(contentHash)}`;
}

export interface ReferenciaDeResumen {
  documentId: string;
  /** SHA-256 del texto de la fuente (`computeContentHash`). */
  contentHash: string;
}

/**
 * Los resúmenes que ya existen, en un solo viaje a Redis.
 *
 * Devuelve sólo los que están; el que falta simplemente no aparece en el mapa.
 */
export async function leerResumenesGuardados(
  redis: RedisClient,
  referencias: ReferenciaDeResumen[]
): Promise<Map<string, string>> {
  const guardados = new Map<string, string>();

  if (referencias.length === 0) return guardados;

  const valores = await redis.mGet(referencias.map((r) => claveDeResumen(r.documentId, r.contentHash)));

  referencias.forEach((referencia, i) => {
    const valor = valores[i];

    if (typeof valor === 'string' && valor.trim()) guardados.set(referencia.documentId, valor);
  });

  return guardados;
}

/**
 * A quién se le cobra el resumen.
 *
 * Todo opcional porque no todos los caminos lo saben, y el resumen se genera
 * igual. Lo que falte se deduce de la fuente: sin `userId` o sin `courseId`, a
 * quien la subió y en su curso; sin `orgId`, la empresa del curso. Un borrador
 * sin fila no tiene a quién, y no se registra.
 */
export interface ConsumoDelResumen {
  orgId?: string;
  userId?: string;
  courseId?: string;
}

export interface PedidoDeResumen extends ReferenciaDeResumen {
  /** El texto a resumir. Viaja con el pedido: quien lo encola ya lo tiene en la mano. */
  texto: string;
  redis: RedisClient;
  consumo?: ConsumoDelResumen;
}

interface Trabajo extends PedidoDeResumen {
  clave: string;
}

const cola: Trabajo[] = [];
/** Lo encolado o en curso en este proceso, para no encolar dos veces lo mismo. */
const pendientes = new Set<string>();
let trabajando = 0;
let esperando: Array<() => void> = [];
let avisoDeColaLlena = false;

/**
 * Pide un resumen en segundo plano. Vuelve enseguida y nunca tira.
 *
 * Si ya está encolado o en curso en este proceso no hace nada; si otro proceso
 * lo está generando, el candado de Redis lo frena al empezar.
 */
export function encolarResumen(pedido: PedidoDeResumen): void {
  if (!pedido.texto?.trim() || !pedido.contentHash) return;

  const clave = claveDeResumen(pedido.documentId, pedido.contentHash);

  if (pendientes.has(clave)) return;

  if (pendientes.size >= MAX_EN_COLA) {
    if (!avisoDeColaLlena) {
      avisoDeColaLlena = true;
      console.warn(`[source-summary] la cola de resúmenes llegó a ${MAX_EN_COLA}; los que sobran se piden la próxima vez`);
    }

    return;
  }

  pendientes.add(clave);
  // Del texto viaja sólo lo que el resumen lee (y una letra más, para que el
  // recorte siga marcando que había más): una fuente puede tener 500 KB, y con
  // la cola llena eso eran cientos de MB retenidos en un servidor chico.
  cola.push({ ...pedido, texto: pedido.texto.slice(0, MAX_DOCUMENT_SUMMARY_INPUT_CHARS + 1), clave });
  despachar();
}

function despachar(): void {
  while (trabajando < RESUMENES_A_LA_VEZ && cola.length > 0) {
    const trabajo = cola.shift()!;

    trabajando += 1;

    void generar(trabajo)
      .catch((error) => {
        console.error(`[source-summary] no se pudo resumir ${trabajo.documentId}:`, error);
      })
      .finally(() => {
        trabajando -= 1;
        pendientes.delete(trabajo.clave);
        despachar();
        avisarSiTermino();
      });
  }
}

function avisarSiTermino(): void {
  if (trabajando > 0 || cola.length > 0) return;

  const avisar = esperando;
  esperando = [];
  avisar.forEach((resolver) => resolver());
}

/**
 * Se resuelve cuando no queda ningún resumen encolado ni en curso.
 *
 * Para los tests y para quien necesite saber que el segundo plano terminó; el
 * chat no lo usa nunca, que es justamente el punto.
 */
export function esperarResumenesEnCurso(): Promise<void> {
  if (trabajando === 0 && cola.length === 0) return Promise.resolve();

  return new Promise((resolver) => esperando.push(resolver));
}

async function generar(trabajo: Trabajo): Promise<void> {
  const { redis, documentId, contentHash } = trabajo;
  const clave = claveDeResumen(documentId, contentHash);
  const candado = claveDeCandado(documentId, contentHash);

  // Otro turno u otro proceso pudo haberlo terminado mientras esto esperaba.
  if (await redis.get(clave)) return;

  const tomado = await redis.set(candado, '1', { NX: true, EX: TTL_CANDADO_SEC });

  if (tomado !== 'OK') return;

  const inicio = Date.now();
  const resumen = await resumirDocumento(trabajo.texto);

  // Se cobra antes de guardar: la llamada ya se pagó aunque guardar falle.
  await registrarConsumo(trabajo, resumen);

  if (!resumen.texto) return;

  await redis.set(clave, resumen.texto, { EX: TTL_RESUMEN_SEC });
  await redis.del(candado).catch(() => undefined);

  console.info(`[source-summary] ${documentId}: resumida en ${Date.now() - inicio} ms`);
}

async function registrarConsumo(trabajo: Trabajo, resumen: ResumenDeDocumento): Promise<void> {
  try {
    let { orgId, userId, courseId } = trabajo.consumo ?? {};

    // El paquete de fuentes y el contexto de documentos piden resúmenes sin
    // saber de quién son: la llamada se paga igual, así que se le cobra a quien
    // subió la fuente, en su curso.
    if (!userId || !courseId) {
      const dueno = await duenoDeFuente(trabajo.documentId);

      userId ||= dueno?.userId;
      courseId ||= dueno?.courseId;
    }

    if (!userId || !courseId) return;

    orgId ||= (await getCourseOrganizationId(courseId)) ?? undefined;

    if (!orgId) return;

    await recordTokenUsage(
      orgId,
      userId,
      courseId,
      {
        promptTokens: resumen.usage.inputTokens ?? 0,
        completionTokens: resumen.usage.outputTokens ?? 0,
        totalTokens: resumen.usage.totalTokens ?? 0,
        reasoningTokens: resumen.usage.outputTokenDetails?.reasoningTokens || undefined,
        cacheReadTokens: resumen.usage.inputTokenDetails?.cacheReadTokens || undefined,
        cacheWriteTokens: resumen.usage.inputTokenDetails?.cacheWriteTokens || undefined
      },
      resumen.modelName,
      resumen.provider
    );
  } catch (error) {
    console.error(`[source-summary] no se pudo registrar el consumo del resumen de ${trabajo.documentId}:`, error);
  }
}
