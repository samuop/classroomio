import { listCourseSources } from '@cio/db/queries/agent/chat-document';
import { getCourseSourceText, getDocumentSummary } from '@api/services/agent/document';
import { VISION_NOTICE } from '@api/services/agent/document-vision';
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
 * Planificar y construir siguen recibiendo el material entero (`source-pack.ts`).
 * Para decidir un temario hay que haber leído todo, y para escribir la lección 9
 * sin repetir la 3 también. El índice es para los demás turnos, que son la
 * mayoría: editar, corregir, agregar una sección, contestar una pregunta.
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
  if (doc.text.startsWith(VISION_NOTICE)) return 'vision';
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
 * Arma el índice de las fuentes de un curso.
 *
 * Los resúmenes salen de Redis cuando ya existen y se calculan una sola vez por
 * documento, así que el índice es barato de repetir. Una fuente cuyo resumen no
 * se pueda obtener entra igual, sin resumen: que el modelo sepa que existe vale
 * más que la descripción.
 */
export async function buildSourceIndex(params: {
  courseId: string;
  redis: RedisClient;
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

  const entries: EntradaDelIndice[] = [];

  for (const doc of ordenados) {
    let resumen: string | null = null;

    try {
      const bruto = await getDocumentSummary(doc.id, params.redis, () =>
        getCourseSourceText(doc.id, params.courseId, params.redis)
      );
      resumen = bruto ? bruto.replace(/\s+/g, ' ').trim().slice(0, MAX_RESUMEN_CHARS) : null;
    } catch (error) {
      console.error(`[source-index] sin resumen para ${doc.id}:`, error);
    }

    entries.push({
      id: doc.id,
      fileName: doc.fileName,
      chars: doc.text.length,
      words: doc.wordCount,
      pageCount: doc.pageCount ?? null,
      comoSeLeyo: comoSeLeyo(doc),
      resumen
    });
  }

  const lineas = entries.map((e, i) => {
    const cabecera = `${i + 1}. "${e.fileName}" (id: ${e.id}) — ${describirLectura(e)}`;

    return e.resumen ? `${cabecera}\n   About: ${e.resumen}` : cabecera;
  });

  const header =
    `## Course Sources — index (${entries.length})\n\n` +
    `The teacher's material for this course. This is the INDEX: it lists what exists, not what it says. ` +
    `Call \`read_source\` with an id to read one, and read the source BEFORE writing anything that claims to come from it.\n\n` +
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
