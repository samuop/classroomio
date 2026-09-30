import { listCourseSources } from '@cio/db/queries/agent/chat-document';
import { getCourseSourceText } from '@api/services/agent/document';
import { esLecturaVisual } from '@api/services/agent/document-vision';
import { extractoDeProsa } from '@api/services/agent/pagina-sin-contenido';
import { encolarResumen, leerResumenesGuardados } from '@api/services/agent/resumenes-de-fuentes';
import { computeContentHash } from '@api/utils/redis/key-generators';
import type { RedisClient } from '@api/utils/redis/redis';

/**
 * El índice de fuentes: qué material tiene el curso, sin el material.
 *
 * ── Por qué existe ───────────────────────────────────────────────────────────
 *
 * Hasta acá había dos estados y ninguno intermedio: o viajaban las fuentes
 * ENTERAS en cada turno, o no viajaba nada. Y lo que decidía cuál de los dos era
 * `context.lessonId` — o sea, si el docente tenía abierta una pestaña de
 * lección. No lo que pidió: dónde estaba parado.
 *
 * Medido en una sesión real de nueve turnos, el paquete viajó en uno. En los
 * otros ocho el agente trabajó sin ver el material, y como nada se lo decía,
 * contestó igual. Encima cada cambio de forma rompe la caché del proveedor: unas
 * 71.000 fichas que se vuelven a pagar enteras.
 *
 * El estado que faltaba es éste. El índice es corto, estable y viaja SIEMPRE:
 * el agente siempre sabe qué material existe, aunque no lo esté leyendo. Y
 * cuando necesita el contenido, lo pide con `read_source`.
 *
 * Es el modelo de archivos: se ve el listado del directorio, se abre lo que hace
 * falta. Un agente que ve el listado puede decir «para esto necesito el manual
 * de higiene, no lo tenés subido»; uno que no ve nada sólo puede adivinar.
 *
 * ── Qué NO reemplaza ─────────────────────────────────────────────────────────
 *
 * Planificar sigue recibiendo el material entero (`source-pack.ts`): para
 * decidir un temario hay que haber leído todo. El índice es para los demás
 * turnos —construir incluido, ver `decidirMaterial`—, que son la mayoría:
 * construir, editar, corregir, agregar una sección, contestar una pregunta.
 */

/** Cómo llegó a texto lo que el agente va a leer. */
export type ComoSeLeyo = 'texto' | 'vision' | 'web';

export interface EntradaDelIndice {
  id: string;
  fileName: string;
  chars: number;
  words: number;
  pageCount: number | null;
  comoSeLeyo: ComoSeLeyo;
  resumen: string | null;
  /**
   * Las primeras letras de prosa, mientras el resumen todavía no existe.
   * `null` cuando hay resumen. Ver `buildSourceIndex`.
   */
  extracto: string | null;
}

export interface IndiceDeFuentes {
  /** El bloque de contexto, o `undefined` cuando el curso no tiene fuentes. */
  text?: string;
  entries: EntradaDelIndice[];
}

const VACIO: IndiceDeFuentes = { entries: [] };

/**
 * Qué forma toma el material de las fuentes en un turno.
 *
 * - `paquete`: todas las fuentes enteras. Sólo al PLANIFICAR: un temario no se
 *   decide con fragmentos, hay que haber leído todo.
 * - `indice`: el listado, y el contenido bajo demanda con `read_source`. Todo lo
 *   demás, construir incluido. Construir recibía el paquete porque el mismo
 *   agente escribía cada lección; ahora las escribe `write_lesson`, que carga
 *   por su cuenta sólo las fuentes de cada lección, y los ejercicios salen de
 *   lo que las lecciones dicen (`read_lessons`). Mandarle todo el material al
 *   constructor en cada paso era pagar por algo que ya no usa, y tentarlo a
 *   escribir él mismo desde ahí.
 * - `ninguno`: el tutor del alumno, o el camino viejo de un documento adjunto
 *   indexado para búsqueda, que trae lo suyo.
 *
 * No recibe qué pantalla tiene abierta el docente, y es a propósito: esa era la
 * condición vieja, y con ella el paquete viajaba en uno de cada nueve turnos.
 */
export function decidirMaterial(params: {
  esDocente: boolean;
  fase: 'plan' | 'build' | 'full';
  hayDocumentoBuscable: boolean;
}): 'paquete' | 'indice' | 'ninguno' {
  if (!params.esDocente || params.hayDocumentoBuscable) return 'ninguno';

  return params.fase === 'plan' ? 'paquete' : 'indice';
}

/** Cuánto del resumen entra en el índice. Es una orientación, no el contenido. */
const MAX_RESUMEN_CHARS = 240;

/**
 * Cómo se obtuvo el texto de esta fuente.
 *
 * Se dice en el índice a propósito, y es la línea que más importa de todas. El
 * caso que originó el arreglo de visión fue un organigrama del que el parser
 * sacó 104 caracteres y que el paquete de fuentes entregó etiquetado como
 * `full text`: el modelo no tenía forma de saber que la extracción había
 * fallado, así que construyó una sección entera sobre lo que no pudo leer.
 *
 * Decir «esto se leyó mirándolo» es decirle al modelo cuánta confianza tenerle
 * a lo que va a leer.
 */
export function comoSeLeyo(doc: { text: string; sourceUrl: string | null }): ComoSeLeyo {
  if (esLecturaVisual(doc.text)) return 'vision';
  if (doc.sourceUrl) return 'web';

  return 'texto';
}

function describirLectura(entrada: EntradaDelIndice): string {
  const tamano = [
    entrada.pageCount ? `${entrada.pageCount} page(s)` : null,
    `${entrada.words.toLocaleString('en-US')} words`
  ]
    .filter(Boolean)
    .join(', ');

  const lectura =
    entrada.comoSeLeyo === 'vision'
      ? 'read VISUALLY — the file had no extractable text, so the pages were transcribed from the images'
      : entrada.comoSeLeyo === 'web'
        ? 'fetched from a web page'
        : 'text extracted from the file';

  return `${tamano}, ${lectura}`;
}

/**
 * Arma el índice de las fuentes de un curso. No espera nunca al modelo.
 *
 * Los resúmenes que ya existen se leen de Redis en un solo viaje. Los que faltan
 * NO se calculan acá: la fuente entra con sus primeras letras de prosa
 * («Begins:») y el resumen se pide en segundo plano (`encolarResumen`), así que
 * el próximo turno ya lo tiene.
 *
 * Antes se calculaban acá, de a uno y con `await`, antes de que el chat mandara
 * las cabeceras: medido en producción, 11 fuentes fueron 38 s de silencio y el
 * navegador cortó a los 30 con «Request timeout», justo al aprobar el plan.
 *
 * `orgId` y `userId` son para cobrar los resúmenes que falten. Son opcionales
 * para no romper a quien no los tenga: sin `orgId` se deduce del curso, y sin
 * `userId` se atribuye a quien subió la fuente.
 */
export async function buildSourceIndex(params: {
  courseId: string;
  redis: RedisClient;
  orgId?: string;
  userId?: string;
}): Promise<IndiceDeFuentes> {
  let documents;

  try {
    documents = await listCourseSources(params.courseId);
  } catch (error) {
    console.error('[source-index] no se pudieron listar las fuentes:', error);
    return VACIO;
  }

  if (documents.length === 0) return VACIO;

  // Mismo orden que el paquete de fuentes: el más viejo primero, que es el orden
  // en que el docente los subió y en el que los piensa. Y, como no depende del
  // turno, produce los mismos bytes siempre — que es lo que la caché necesita.
  const ordenados = [...documents].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  // El hash se calcula del texto y no se toma de la fila: es la misma cuenta que
  // hace `getDocumentSummary`, y dos maneras de sacarlo serían dos claves para
  // el mismo resumen.
  const referencias = ordenados.map((doc) => ({ documentId: doc.id, contentHash: computeContentHash(doc.text) }));

  let guardados = new Map<string, string>();

  try {
    guardados = await leerResumenesGuardados(params.redis, referencias);
  } catch (error) {
    // Sin Redis el índice sale igual, con los extractos: que el modelo sepa qué
    // fuentes existen vale más que la descripción de cada una.
    console.error('[source-index] no se pudieron leer los resúmenes:', error);
  }

  const entries: EntradaDelIndice[] = ordenados.map((doc, i) => {
    const bruto = guardados.get(doc.id);

    if (!bruto) {
      encolarResumen({
        ...referencias[i],
        texto: doc.text,
        redis: params.redis,
        consumo: { orgId: params.orgId, userId: params.userId ?? doc.userId, courseId: params.courseId }
      });
    }

    const resumen = bruto ? bruto.replace(/\s+/g, ' ').trim().slice(0, MAX_RESUMEN_CHARS) : null;

    return {
      id: doc.id,
      fileName: doc.fileName,
      chars: doc.text.length,
      words: doc.wordCount,
      pageCount: doc.pageCount ?? null,
      comoSeLeyo: comoSeLeyo(doc),
      resumen,
      extracto: resumen ? null : extractoDeProsa(doc.text, MAX_RESUMEN_CHARS) || null
    };
  });

  const lineas = entries.map((e, i) => {
    const cabecera = `${i + 1}. "${e.fileName}" (id: ${e.id}) — ${describirLectura(e)}`;

    if (e.resumen) return `${cabecera}\n   About: ${e.resumen}`;

    // Otra etiqueta a propósito: son las primeras palabras del texto, no una
    // descripción, y el modelo tiene que poder distinguirlas.
    if (e.extracto) return `${cabecera}\n   Begins: ${e.extracto}`;

    return cabecera;
  });

  // La diferencia entre las dos etiquetas se le dice al modelo: un «Begins:» es
  // el menú o el primer párrafo de la fuente, y tomarlo por una descripción de
  // todo su contenido es decidir con la tapa del libro.
  const header =
    `## Course Sources — index (${entries.length})\n\n` +
    `The teacher's material for this course. This is the INDEX: it lists what exists, not what it says. ` +
    `An "About:" line is a short summary of the source; a "Begins:" line is only its first words, shown while the summary is not ready — it does not tell you what the rest covers. ` +
    `Call \`read_source\` with an id to read one, and read the source BEFORE writing anything that claims to come from it. To find which source covers a topic, search first with search_document, then read only around what it finds.\n\n` +
    `If a lesson needs material that is not in this list, say so and name the document you would need. ` +
    `Do not fill the gap from general knowledge without telling the teacher you are doing it.\n\n`;

  return { text: header + lineas.join('\n'), entries };
}

/** Tope de caracteres que devuelve una lectura. Ver `leerFuente`. */
export const MAX_LECTURA_CHARS = 40_000;

/** Líneas por lectura cuando quien llama no pide otra cosa. */
export const LINEAS_POR_LECTURA = 600;

export interface LecturaDeFuente {
  fileName: string;
  /** Texto numerado por línea, listo para que el modelo lo cite y lo continúe. */
  content: string;
  desdeLinea: number;
  hastaLinea: number;
  totalLineas: number;
  /** Verdadero cuando quedó texto sin leer después de `hastaLinea`. */
  hayMas: boolean;
}

/**
 * Lee un tramo de una fuente.
 *
 * Numerada por línea y paginada, como se lee un archivo: sin eso, «leé el
 * documento» sobre un PDF de doscientas páginas es la misma bomba de contexto
 * que el volcado automático, sólo que disparada a mano.
 *
 * Devuelve `null` cuando la fuente no existe o no es de este curso — quien llama
 * lo convierte en un error que el modelo puede leer y corregir.
 */
export async function leerFuente(params: {
  documentId: string;
  courseId: string;
  redis: RedisClient;
  offset?: number;
  limit?: number;
}): Promise<LecturaDeFuente | null> {
  let documents;

  try {
    documents = await listCourseSources(params.courseId);
  } catch (error) {
    console.error('[source-index] no se pudieron listar las fuentes:', error);
    return null;
  }

  const doc = documents.find((d) => d.id === params.documentId);

  if (!doc) return null;

  const texto = (await getCourseSourceText(doc.id, params.courseId, params.redis)) ?? doc.text;

  return { fileName: doc.fileName, ...recortarLineas(texto, params.offset, params.limit) };
}

/**
 * El tramo que se devuelve, numerado.
 *
 * Separado de la lectura porque acá están los bordes que importan, y fijarlos no
 * necesita ni base ni red.
 */
export function recortarLineas(texto: string, offset?: number, limit?: number): Omit<LecturaDeFuente, 'fileName'> {
  const lineas = texto.split('\n');

  const desde = Math.max(1, Math.floor(offset ?? 1));
  const cuantas = Math.max(1, Math.floor(limit ?? LINEAS_POR_LECTURA));
  const hasta = Math.min(lineas.length, desde + cuantas - 1);

  const tramo: string[] = [];
  let usados = 0;
  let ultima = desde - 1;

  for (let n = desde; n <= hasta; n++) {
    const linea = lineas[n - 1] ?? '';
    const rotulada = `${n}\t${linea}`;

    // El tope de caracteres manda sobre el de líneas: un documento sin saltos de
    // línea es UNA línea de doscientos mil caracteres, y contarla como "una"
    // metería el documento entero por la puerta de atrás — que es exactamente el
    // volcado automático que esto vino a reemplazar.
    if (usados > 0 && usados + rotulada.length > MAX_LECTURA_CHARS) break;

    tramo.push(rotulada.slice(0, MAX_LECTURA_CHARS));
    usados += rotulada.length + 1;
    ultima = n;
  }

  return {
    content: tramo.join('\n'),
    desdeLinea: desde,
    hastaLinea: ultima,
    totalLineas: lineas.length,
    // Pedir más allá del final no es "hay más": es una lectura vacía. Decir que
    // hay más mandaría al modelo a un bucle de lecturas que no devuelven nada.
    hayMas: ultima >= desde && ultima < lineas.length
  };
}
