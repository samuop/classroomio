import { nanoid } from 'nanoid';
import { AppError } from '@api/utils/errors';
import { decidirSiMirar, leerDocumentoConVision } from '@api/services/agent/document-vision';

/**
 * Title of the hidden conversation every course source lands in.
 *
 * Vive en el paquete de la base desde que la base tiene que reconocerla —para
 * no listarla en el historial, reusarla en vez de abrir otra y mudar a ella las
 * fuentes de un chat que se borra—. Se reexporta acá para que los que ya la
 * importaban de este módulo no cambien.
 */
export { SOURCES_CONVERSATION_TITLE } from '@cio/db/queries/agent/chat-history';
import {
  MAX_DOCUMENT_TEXT_LENGTH,
  MAX_AGENT_DOCUMENT_SIZE,
  DOCUMENT_REDIS_TTL,
  SUPPORTED_DOCUMENT_TYPES
} from '@cio/ai-assistant';
import type { DocumentUploadResult } from '@cio/ai-assistant';
import { agentDocumentKey, computeContentHash } from '@api/utils/redis/key-generators';
import { encolarResumen, leerResumenesGuardados, type ConsumoDelResumen } from '@api/services/agent/resumenes-de-fuentes';
import { fetchDocumentationUrl, PLAZO_DE_LECTURA_A_MANO_MS } from '@api/services/agent/fetch-url';
import { diagnosticarFuente, errorDePaginaSinContenido, esNombreDeMuro } from '@api/services/agent/pagina-sin-contenido';
import { trackAgentEvent, AgentEvent } from '@api/utils/tinybird';
import type { RedisClient } from '@api/utils/redis/redis';
import {
  actualizarLecturaDeFuente,
  CODIGO_TOPE_DE_FUENTES,
  contarFuentesDelCurso,
  createChatDocument,
  esTopeDeFuentes,
  getChatDocument,
  getCourseSource,
  findChatDocumentByContentHash,
  MAX_SOURCES_PER_COURSE,
  type ChatDocumentRecord
} from '@cio/db/queries/agent';
import { buscarFuentePorDireccion, reemplazarFuenteWeb } from '@cio/db/queries/agent/fuentes-del-curso';
import { getCourseOrganizationId } from '@cio/db/queries/tag';
import { generateFileKey } from '@api/utils/upload';
import { getFromS3, uploadToS3 } from '@api/utils/s3';
import { getStorageConfig } from '@api/config/storage';
import { createAssetFromUploadService } from '@api/services/assets/assets';
import { getAssetsByIds } from '@cio/db/queries/assets';
import { leerLibro, PlanillaIlegibleError, type MotivoIlegible } from '@api/services/agent/planilla/leer-libro';
import { mapaDelLibro } from '@api/services/agent/planilla/mapa-del-libro';
import { tipoDelArchivo, TIPO_XLSM, TIPO_XLSX } from '@api/services/agent/planilla/tipos';

/**
 * Versión del lector de archivos.
 *
 * Se sube cuando cambia lo que el lector es capaz de sacar de un archivo — no
 * cuando se toca cualquier cosa de este módulo. Hoy vale 1: la lectura por
 * visión, que transcribe las páginas de un PDF sin texto extraíble.
 *
 * Para qué sirve: el texto se extrae UNA vez y es lo único que el agente
 * conoce del documento. Sin este número, cada mejora del lector nace sin
 * alcance sobre lo ya subido y no hay forma de saber qué quedó atrás. Con él,
 * `fuenteConLecturaVieja` puede señalarlo y `releerFuente` rehacerlo.
 */
export const EXTRACTOR_VERSION = 1;

/**
 * El 422 que ve la docente cuando el curso ya tiene todas las fuentes que puede
 * tener. El panel lo traduce por el `code`. Ver `MAX_SOURCES_PER_COURSE`: una
 * fuente nunca se borra sola para hacerle lugar a otra.
 */
export function errorDeTopeDeFuentes(): AppError {
  return new AppError(
    `This course already has ${MAX_SOURCES_PER_COURSE} sources: delete one before adding another`,
    CODIGO_TOPE_DE_FUENTES,
    422
  );
}

/** Si un error es el rechazo del tope, el de la base o el 422 de acá. */
export { esTopeDeFuentes };

/** Cuántas fuentes más entran en el curso. */
export async function lugarParaFuentes(courseId: string): Promise<number> {
  return Math.max(0, MAX_SOURCES_PER_COURSE - (await contarFuentesDelCurso(courseId)));
}

/**
 * Rechaza una fuente nueva ANTES de gastar en ella: subir el archivo al
 * almacenamiento o leer la página. El alta vuelve a mirar el tope adentro de su
 * transacción (`createChatDocument`); esto es para no gastar de balde.
 */
export async function exigirLugarParaUnaFuente(courseId: string): Promise<void> {
  if ((await lugarParaFuentes(courseId)) <= 0) throw errorDeTopeDeFuentes();
}

/**
 * Lo mismo para una página, con una excepción: si esa dirección ya es fuente
 * del curso, agregarla otra vez la relee en su lugar y no ocupa uno nuevo.
 */
export async function exigirLugarParaUnaPagina(courseId: string, url: string): Promise<void> {
  if ((await lugarParaFuentes(courseId)) > 0) return;
  if (await buscarFuentePorDireccion(courseId, direccionesPosibles(url))) return;

  throw errorDeTopeDeFuentes();
}

/** El alta de una fuente, con el tope convertido en el 422 que ve la docente. */
async function crearFuente(record: Parameters<typeof createChatDocument>[0]): Promise<void> {
  try {
    await createChatDocument(record);
  } catch (error) {
    if (esTopeDeFuentes(error)) throw errorDeTopeDeFuentes();

    throw error;
  }
}

/**
 * ¿A esta fuente le conviene una lectura nueva?
 *
 * Dos condiciones, y las dos importan:
 *   - se leyó con una versión anterior del lector, y
 *   - tenemos el archivo original para volver a leerlo (`assetId`).
 *
 * Una página web queda afuera a propósito: su "lector" es la descarga, y una
 * versión nueva del lector de PDFs no la deja vieja. Releerla sería volver a
 * bajar la página, que es otra acción y otra decisión del docente.
 */
export function fuenteConLecturaVieja(doc: { extractorVersion: number; assetId: string | null }): boolean {
  return doc.extractorVersion < EXTRACTOR_VERSION && !!doc.assetId;
}

export interface ParsedDocument {
  text: string;
  fileName: string;
  mimeType: string;
  pageCount: number | null;
  wordCount: number;
  textPreview: string;
  truncated: boolean;
  /** El archivo original ya guardado, cuando lo subio alguien. Viaja por el
   *  borrador para que se pueda descargar desde la lista de fuentes. */
  assetId?: string | null;
  /**
   * De donde salio, cuando salio de la web.
   *
   * Ausente en un archivo subido: ahi el original lo tenemos nosotros. Viaja
   * hasta `promoteDraftDocuments` para que una pagina que el asistente de
   * creacion investigo ANTES de que el curso existiera llegue a la lista de
   * fuentes con su enlace, igual que una que se agrego con el curso ya hecho.
   */
  sourceUrl?: string;
}

/**
 * Validate and extract text from an uploaded document (PDF, DOCX, PPTX). Does
 * not store anything — callers persist as needed. Throws 415/413 on bad input.
 */
export async function parseDocument(file: File): Promise<ParsedDocument> {
  const mimeType = tipoDelArchivo(file.name, file.type);

  if (!SUPPORTED_DOCUMENT_TYPES.includes(mimeType as (typeof SUPPORTED_DOCUMENT_TYPES)[number])) {
    throw new AppError('Unsupported file type. Allowed: PDF, DOCX, PPTX, XLSX', 'UNSUPPORTED_FILE_TYPE', 415);
  }

  if (file.size > MAX_AGENT_DOCUMENT_SIZE) {
    throw new AppError(
      `File too large. Maximum size is ${MAX_AGENT_DOCUMENT_SIZE / (1024 * 1024)}MB`,
      'FILE_TOO_LARGE',
      413
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  let extractedText: string;
  let pageCount: number | null = null;

  switch (mimeType) {
    case 'application/pdf':
      ({ text: extractedText, pageCount } = await extractPdfText(buffer));
      break;
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      extractedText = await extractDocxText(buffer);
      break;
    case 'application/vnd.openxmlformats-officedocument.presentationml.presentation':
      ({ text: extractedText, pageCount } = await extractPptxText(buffer));
      break;
    case TIPO_XLSX:
    case TIPO_XLSM:
      // El texto de una planilla es su mapa: cómo está armada, de dónde sale
      // cada dato y sus fórmulas en castellano. El libro entero queda en el
      // original, que el asistente consulta con `inspect_spreadsheet`.
      ({ text: extractedText, pageCount } = await extractSpreadsheetMap(buffer, file.name));
      break;
    default:
      throw new AppError('Unsupported file type', 'UNSUPPORTED_FILE_TYPE', 415);
  }

  /**
   * Si de este archivo no salió texto plausible, MIRARLO antes de darlo por
   * bueno.
   *
   * Un organigrama, un diagrama o un PowerPoint exportado a PDF son imágenes:
   * el parser devuelve casi nada y hasta acá esa nada seguía viaje etiquetada
   * como el documento completo. Ver `document-vision.ts` para el caso real que
   * originó esto.
   *
   * Sólo PDF: es el único formato que el modelo lee de forma nativa. Un DOCX o
   * un PPTX habría que rasterizarlo primero, y eso es otro problema.
   */
  if (mimeType === 'application/pdf') {
    const decision = decidirSiMirar({ textoExtraido: extractedText, pageCount, bytes: buffer.length });

    if (decision.leer) {
      console.info(
        `[parseDocument] "${file.name}": ${extractedText.trim().length} caracteres en ${pageCount} página(s) — ` +
          `leyendo con visión (${decision.porque})`
      );

      const visto = await leerDocumentoConVision({
        buffer,
        mediaType: mimeType,
        fileName: file.name,
        porque: decision.porque
      });

      // La transcripción reemplaza y no se suma: el modelo que miró el PDF ve
      // también su capa de texto, así que lo que devuelve ya la contiene.
      if (visto) extractedText = visto.texto;
    }
  }

  const truncated = extractedText.length > MAX_DOCUMENT_TEXT_LENGTH;

  if (truncated) {
    extractedText = extractedText.slice(0, MAX_DOCUMENT_TEXT_LENGTH);
  }

  const wordCount = extractedText.split(/\s+/).filter(Boolean).length;
  const textPreview = extractedText.slice(0, 200);

  return { text: extractedText, fileName: file.name, mimeType, pageCount, wordCount, textPreview, truncated };
}

/**
 * Store an already-parsed document as a DRAFT — Redis only, no conversation,
 * no course, no S3/asset/Postgres. Used by the pre-creation course wizard so a
 * teacher can attach material before the course exists. The stored `userId`
 * lets getDocumentText's ownership check pass on the first chat turn.
 */
/**
 * Guarda el archivo ORIGINAL y lo registra como asset de la organizacion.
 *
 * Del archivo subido nos quedabamos solo con el texto extraido, que es lo que
 * el modelo necesita. Pero quien lo subio tambien quiere poder BAJARLO despues
 * desde la lista de fuentes, y para eso hay que conservar el archivo, no su
 * transcripcion.
 *
 * Es el mismo camino que usan las lecciones (S3 + tabla de assets), asi que el
 * archivo tambien aparece en el gestor de medios de la organizacion.
 */
export async function storeOriginalFile(params: {
  file: File;
  buffer: Buffer;
  mimeType: string;
  orgId: string;
  userId: string;
  conversationId?: string;
}): Promise<{ id: string }> {
  const { file, buffer, mimeType, orgId, userId, conversationId } = params;
  const storageKey = generateFileKey(file.name);
  const storageConfig = getStorageConfig();
  const uploadResult = await uploadToS3({
    Bucket: storageConfig.bucketDocuments,
    Key: storageKey,
    Body: buffer,
    ContentType: mimeType
  });

  if (!uploadResult.success) {
    throw new AppError(
      `Failed to upload document to storage: ${uploadResult.error ?? 'unknown error'}`,
      'DOCUMENT_STORAGE_FAILED',
      500
    );
  }

  return createAssetFromUploadService(orgId, userId, {
    kind: 'document',
    provider: 'upload',
    storageProvider: 's3',
    storageKey,
    byteSize: file.size,
    mimeType,
    title: file.name,
    isExternal: false,
    metadata: { source: 'ai_chat', conversationId }
  });
}

/**
 * Lo mismo, pero sin derecho a tumbar la subida.
 *
 * En el asistente de creacion el curso todavia no existe y lo que la persona
 * vino a hacer es armarlo con ese material. Si el almacenamiento falla, perder
 * la copia descargable es molesto; abortar la subida y dejarla sin poder
 * avanzar es peor. Por eso aca se traga el error y se sigue con el texto, que
 * es lo que hace falta para construir.
 *
 * Contrapartida asumida: un borrador que nunca se promueve —la persona
 * abandona el asistente— deja el archivo en el almacenamiento sin ninguna fila
 * que lo referencie. Son 5 MB como maximo y solo cuando alguien abandona a
 * mitad de camino.
 */
export async function storeOriginalFileBestEffort(
  params: Parameters<typeof storeOriginalFile>[0]
): Promise<string | null> {
  try {
    const asset = await storeOriginalFile(params);

    return asset.id;
  } catch (error) {
    console.warn('[agent.documents] no se pudo guardar el archivo original del borrador:', error);

    return null;
  }
}

export async function storeDraftDocument(
  parsed: ParsedDocument,
  userId: string,
  redis: RedisClient
): Promise<{ documentId: string }> {
  const documentId = nanoid();

  await redis.set(
    agentDocumentKey(documentId),
    JSON.stringify({
      text: parsed.text,
      fileName: parsed.fileName,
      mimeType: parsed.mimeType,
      userId,
      uploadedAt: new Date().toISOString(),
      // Carried so `promoteDraftDocuments` can persist a faithful record instead
      // of recomputing an approximation from the text.
      wordCount: parsed.wordCount,
      pageCount: parsed.pageCount,
      sourceUrl: parsed.sourceUrl ?? null,
      assetId: parsed.assetId ?? null
    }),
    { EX: DOCUMENT_REDIS_TTL }
  );

  return { documentId };
}

/**
 * Turn draft documents into real course sources the first time a chat uses them.
 *
 * The course wizard says "we'll use them as a source for your course", but a
 * draft lives in Redis only — no course, no row — because at upload time the
 * course does not exist yet. Nothing ever moved it across, so the material was
 * invisible in the Sources panel and, worse, GONE once DOCUMENT_REDIS_TTL (1h)
 * expired: a course built from a document that no longer existed anywhere, with
 * no way for the agent to re-read it or the teacher to recover it.
 *
 * Runs on the chat turn because that is the first moment both halves exist — the
 * draft id and a real course. Best-effort by design: a failure here must not take
 * down the turn, since the model can still read the text from Redis.
 *
 * The original bytes are not kept (the draft upload never touched S3), so the
 * promoted row has no asset. The extracted text — the part the agent actually
 * needs — is preserved in full.
 */
export async function promoteDraftDocuments(
  documentIds: string[],
  /** `orgId` es para cobrar el resumen de cada fuente promovida; sin él se deduce del curso. */
  params: { userId: string; courseId: string; conversationId: string; orgId?: string },
  redis: RedisClient
): Promise<number> {
  let promoted = 0;

  for (const documentId of documentIds) {
    try {
      if (await getChatDocument(documentId, params.userId)) continue;

      const raw = await redis.get(agentDocumentKey(documentId));
      if (!raw) continue;

      const draft = JSON.parse(raw) as {
        text?: string;
        fileName?: string;
        mimeType?: string;
        userId?: string;
        wordCount?: number;
        pageCount?: number;
        sourceUrl?: string | null;
        assetId?: string | null;
      };

      // Someone else's draft id: leave it alone rather than copying their
      // material into this teacher's course.
      if (!draft.text || (draft.userId && draft.userId !== params.userId)) continue;

      const contentHash = computeContentHash(draft.text);
      const existing = await findChatDocumentByContentHash(params.courseId, contentHash);
      if (existing) continue;

      await crearFuente({
        id: documentId,
        conversationId: params.conversationId,
        courseId: params.courseId,
        userId: params.userId,
        assetId: draft.assetId ?? null,
        sourceUrl: draft.sourceUrl ?? null,
        fileName: draft.fileName ?? 'document',
        mimeType: draft.mimeType ?? 'application/octet-stream',
        text: draft.text,
        contentHash,
        wordCount: draft.wordCount ?? draft.text.split(/\s+/).filter(Boolean).length,
        pageCount: draft.pageCount ?? null,
        extractorVersion: draft.assetId ? EXTRACTOR_VERSION : 0
      });

      // El resumen se pide acá, cuando la fuente nace, y no cuando el índice lo
      // necesita: así el primer turno de construcción ya lo encuentra hecho.
      encolarResumen({
        documentId,
        contentHash,
        texto: draft.text,
        redis,
        consumo: { orgId: params.orgId, userId: params.userId, courseId: params.courseId }
      });

      promoted += 1;
      console.log(`[agent.documents] promoted draft ${documentId} to source of course ${params.courseId}`);
    } catch (error) {
      // `esTopeDeFuentes` reconoce también el 422 de `crearFuente`: lleva el mismo `code`.
      if (esTopeDeFuentes(error)) {
        // Un curso recién creado no llega al tope con sus borradores; si pasa,
        // que quede escrito cuál no entró.
        console.warn(`[agent.documents] draft ${documentId} not promoted: course ${params.courseId} is at its source limit`);
        continue;
      }

      console.warn(`[agent.documents] could not promote draft ${documentId}:`, error);
    }
  }

  return promoted;
}

/**
 * Parse an uploaded document, store extracted text in Redis (hot cache) and Postgres
 * (durable, scoped to a conversation). Supports PDF, DOCX, and PPTX files.
 */
export async function parseAndStoreDocument(
  file: File,
  orgId: string,
  userId: string,
  courseId: string,
  conversationId: string,
  redis: RedisClient
): Promise<DocumentUploadResult> {
  const parsed = await parseDocument(file);
  const { text: extractedText, mimeType, pageCount, wordCount, textPreview, truncated } = parsed;
  const buffer = Buffer.from(await file.arrayBuffer());

  // Hash the extracted text so users in the same course can share cache
  // entries for identical files. Same content → same hash → same cache key.
  const contentHash = computeContentHash(extractedText);

  // Multi-user dedup: if any user in the same course already uploaded a
  // document with the same content, return that documentId instead of
  // creating a duplicate row + S3 asset. The first user keeps the original
  // reference; subsequent uploads only bump the conversation attachment.
  const existing = await findChatDocumentByContentHash(courseId, contentHash);
  if (existing) {
    // Make the cached text available for this user via the standard Redis
    // key, then return the existing id.
    await redis.set(
      agentDocumentKey(existing.id),
      JSON.stringify({
        text: existing.text,
        fileName: existing.fileName,
        mimeType: existing.mimeType,
        userId: existing.userId,
        uploadedAt: existing.createdAt
      }),
      { EX: DOCUMENT_REDIS_TTL }
    );
    return {
      documentId: existing.id,
      fileName: existing.fileName,
      mimeType: existing.mimeType,
      pageCount: existing.pageCount,
      wordCount: existing.wordCount,
      textPreview,
      truncated
    };
  }

  // Antes de subir el original: un archivo que no va a entrar no tiene por qué
  // quedar en el almacenamiento.
  await exigirLugarParaUnaFuente(courseId);

  const documentId = nanoid();

  const asset = await storeOriginalFile({ file, buffer, mimeType, orgId, userId, conversationId });

  await redis.set(
    agentDocumentKey(documentId),
    JSON.stringify({
      text: extractedText,
      fileName: file.name,
      mimeType,
      userId,
      uploadedAt: new Date().toISOString()
    }),
    { EX: DOCUMENT_REDIS_TTL }
  );

  await crearFuente({
    id: documentId,
    conversationId,
    courseId,
    userId,
    assetId: asset.id,
    fileName: file.name,
    mimeType,
    text: extractedText,
    contentHash,
    wordCount,
    pageCount,
    extractorVersion: EXTRACTOR_VERSION
  });

  // Sin `orgId`: el de la cabecera puede ser el de la consultora mirando el
  // curso de una empresa cliente, y el resumen es consumo del curso. Lo deduce
  // `resumenes-de-fuentes` a partir del curso.
  encolarResumen({ documentId, contentHash, texto: extractedText, redis, consumo: { userId, courseId } });

  trackAgentEvent(AgentEvent.DOCUMENT_UPLOADED, {
    orgId,
    userId,
    courseId,
    mimeType,
    fileSize: file.size,
    wordCount,
    truncated
  });

  return {
    documentId,
    fileName: file.name,
    mimeType,
    pageCount,
    wordCount,
    textPreview,
    truncated
  };
}

/** MIME type used for sources captured from a web page (Jina returns markdown). */
export const URL_SOURCE_MIME_TYPE = 'text/markdown';

/** Una página leída, lista para guardarse como fuente. */
interface PaginaComoFuente {
  text: string;
  truncated: boolean;
  wordCount: number;
  fileName: string;
  contentHash: string;
}

function prepararPaginaWeb(params: { url: string; pageTitle: string; markdown: string }): PaginaComoFuente {
  const text = params.markdown.slice(0, MAX_DOCUMENT_TEXT_LENGTH);
  // Title first, falling back to the URL, so the Sources list is readable. The
  // equality guard avoids "es.wikipedia.org (es.wikipedia.org)" when the title
  // could not be extracted and already degraded to the hostname.
  const hostname = new URL(params.url).hostname;
  const title = params.pageTitle?.trim();

  return {
    text,
    truncated: params.markdown.length > MAX_DOCUMENT_TEXT_LENGTH,
    wordCount: text.split(/\s+/).filter(Boolean).length,
    fileName: title ? (title === hostname ? params.url : `${title} (${hostname})`) : params.url,
    contentHash: computeContentHash(text)
  };
}

/**
 * Las formas en que puede estar guardada una misma dirección.
 *
 * La ruta de Fuentes guarda la dirección tal como la pegó la docente y la
 * investigación la guarda normalizada (`new URL().href`): buscar sólo una de
 * las dos haría que la misma página, agregada por los dos caminos, no se
 * reconozca.
 */
function direccionesPosibles(url: string): string[] {
  try {
    return [...new Set([url, new URL(url).href])];
  } catch {
    return [url];
  }
}

/**
 * Pone la lectura nueva de una página en la fuente que ya existía.
 *
 * Misma fuente —mismo id, mismo lugar en el panel, mismas lecciones que la
 * citan—, texto nuevo. El nombre NO cambia: el plan aprobado declara sus
 * fuentes por nombre, y si el título de la página cambió, la lección perdía su
 * fuente sin aviso (el escritor no recibía el material y la cobertura la daba
 * por inexistente). La excepción es un nombre de muro: una fuente que se guardó
 * como «Google Sheets: Sign-in» y ahora se leyó bien no puede seguir llamándose
 * así.
 *
 * Devuelve el nombre con que quedó.
 */
async function reemplazarLecturaWeb(
  documentId: string,
  nombreActual: string,
  pagina: PaginaComoFuente,
  redis: RedisClient,
  consumo: ConsumoDelResumen
): Promise<string> {
  const fileName = esNombreDeMuro(nombreActual) ? pagina.fileName : nombreActual;

  await reemplazarFuenteWeb(documentId, {
    text: pagina.text,
    fileName,
    wordCount: pagina.wordCount,
    contentHash: pagina.contentHash
  });

  // La copia caliente del texto describe la lectura vieja. El resumen viejo no
  // hace falta borrarlo: su clave lleva el hash del texto anterior, así que
  // nadie lo va a encontrar para el texto nuevo.
  await redis.del(agentDocumentKey(documentId));

  encolarResumen({ documentId, contentHash: pagina.contentHash, texto: pagina.text, redis, consumo });

  return fileName;
}

/**
 * Persist a fetched web page as a course source, alongside uploaded PDFs.
 *
 * A URL used to reach the model only as a `fetch_documentation_url` tool result
 * living in the chat transcript — and build mode drops the transcript, so the page
 * vanished at exactly the moment the course was written from it. Stored as a
 * document instead, it shows up in the Sources panel, joins the cached source
 * pack, and survives the build.
 *
 * There is no S3 asset (`assetId: null`): the original lives at its URL.
 *
 * Una página que el curso ya tiene —la misma dirección— no se duplica: si el
 * texto es el mismo se devuelve la que estaba (`reused`), y si cambió se le
 * reemplaza el texto (`replaced`). Antes la comparación era sólo por el texto,
 * así que volver a agregar una página que había cambiado creaba una segunda
 * fuente, y volver a agregar el muro de una planilla recién compartida devolvía
 * el mismo muro como si nada. Entre páginas DISTINTAS con el mismo texto sigue
 * valiendo la comparación por hash.
 */
export async function storeUrlDocument(params: {
  url: string;
  pageTitle: string;
  markdown: string;
  orgId: string;
  userId: string;
  courseId: string;
  conversationId: string;
  redis: RedisClient;
}): Promise<DocumentUploadResult & { reused: boolean; replaced: boolean }> {
  const { url, pageTitle, markdown, orgId, userId, courseId, conversationId, redis } = params;

  const pagina = prepararPaginaWeb({ url, pageTitle, markdown });
  const { text, truncated, wordCount, fileName, contentHash } = pagina;

  const mismaDireccion = await buscarFuentePorDireccion(courseId, direccionesPosibles(url));

  if (mismaDireccion) {
    if (hashDeLaFuente(mismaDireccion) === contentHash) {
      return {
        documentId: mismaDireccion.id,
        fileName: mismaDireccion.fileName,
        mimeType: mismaDireccion.mimeType,
        pageCount: mismaDireccion.pageCount,
        wordCount: mismaDireccion.wordCount,
        textPreview: text.slice(0, 500),
        truncated,
        reused: true,
        replaced: false
      };
    }

    const nombre = await reemplazarLecturaWeb(mismaDireccion.id, mismaDireccion.fileName, pagina, redis, {
      userId,
      courseId
    });

    return {
      documentId: mismaDireccion.id,
      fileName: nombre,
      mimeType: URL_SOURCE_MIME_TYPE,
      pageCount: null,
      wordCount,
      textPreview: text.slice(0, 500),
      truncated,
      reused: false,
      replaced: true
    };
  }

  const existing = await findChatDocumentByContentHash(courseId, contentHash);
  if (existing) {
    return {
      documentId: existing.id,
      fileName: existing.fileName,
      mimeType: existing.mimeType,
      pageCount: existing.pageCount,
      wordCount: existing.wordCount,
      textPreview: text.slice(0, 500),
      truncated,
      reused: true,
      replaced: false
    };
  }

  await exigirLugarParaUnaFuente(courseId);

  const documentId = nanoid();

  await redis.set(
    agentDocumentKey(documentId),
    JSON.stringify({
      text,
      fileName,
      mimeType: URL_SOURCE_MIME_TYPE,
      userId,
      uploadedAt: new Date().toISOString()
    }),
    { EX: DOCUMENT_REDIS_TTL }
  );

  await crearFuente({
    id: documentId,
    conversationId,
    courseId,
    userId,
    assetId: null,
    // Lo que antes se tiraba. El nombre del archivo lleva el titulo y el
    // dominio, pero de "Colorimetria (wikipedia.org)" no se puede volver a la
    // pagina: hay que guardar la direccion entera o se pierde.
    sourceUrl: url,
    fileName,
    mimeType: URL_SOURCE_MIME_TYPE,
    text,
    contentHash,
    wordCount,
    pageCount: null
  });

  // El resumen nace con la fuente, en segundo plano: el índice del próximo
  // turno lo encuentra hecho en vez de pedirlo él.
  encolarResumen({ documentId, contentHash, texto: text, redis, consumo: { userId, courseId } });

  trackAgentEvent(AgentEvent.DOCUMENT_UPLOADED, {
    orgId,
    userId,
    courseId,
    mimeType: URL_SOURCE_MIME_TYPE,
    fileSize: text.length,
    wordCount,
    truncated
  });

  return {
    documentId,
    fileName,
    mimeType: URL_SOURCE_MIME_TYPE,
    pageCount: null,
    wordCount,
    textPreview: text.slice(0, 500),
    truncated,
    reused: false,
    replaced: false
  };
}

/**
 * Retrieve stored document text. Tries the Redis hot cache first; on miss
 * falls back to Postgres and rehydrates Redis for next time.
 */
export async function getDocumentText(documentId: string, userId: string, redis: RedisClient): Promise<string | null> {
  const raw = await redis.get(agentDocumentKey(documentId));

  if (raw) {
    const parsed = JSON.parse(raw) as { text: string; userId?: string };

    if (parsed.userId && parsed.userId !== userId) return null;

    return parsed.text;
  }

  const record = await getChatDocument(documentId, userId);

  if (!record) return null;

  await redis.set(
    agentDocumentKey(documentId),
    JSON.stringify({
      text: record.text,
      fileName: record.fileName,
      mimeType: record.mimeType,
      userId: record.userId,
      uploadedAt: record.createdAt
    }),
    { EX: DOCUMENT_REDIS_TTL }
  );

  return record.text;
}

/**
 * El texto de una fuente DEL CURSO, sin mirar quién la subió.
 *
 * Misma caché que `getDocumentText` —la entrada de Redis es por documento, así
 * que se reaprovecha— pero sin el chequeo de dueño: acá la autorización ya la
 * dio el curso (ver `listCourseSources`). Sin esta versión, el índice listaría
 * la fuente de un compañero de equipo y `read_source` devolvería "no existe".
 *
 * El `courseId` ata el documento al curso autorizado. La entrada cacheada no
 * lo guarda, así que en un acierto de caché la comprobación no corre; por eso
 * la entrada se escribe sólo después de que Postgres confirmó la pertenencia,
 * y la clave de Redis es el id del documento, que ya es único por curso.
 */
export async function getCourseSourceText(
  documentId: string,
  courseId: string,
  redis: RedisClient
): Promise<string | null> {
  const raw = await redis.get(agentDocumentKey(documentId));

  if (raw) {
    const parsed = JSON.parse(raw) as { text: string; courseId?: string };

    // Una entrada vieja (escrita antes de este cambio) no trae `courseId`: se
    // ignora y se va a Postgres, que sí puede comprobarlo.
    if (parsed.courseId === courseId) return parsed.text;
  }

  const record = await getCourseSource(documentId, courseId);

  if (!record) return null;

  await redis.set(
    agentDocumentKey(documentId),
    JSON.stringify({
      text: record.text,
      fileName: record.fileName,
      mimeType: record.mimeType,
      userId: record.userId,
      courseId: record.courseId,
      uploadedAt: record.createdAt
    }),
    { EX: DOCUMENT_REDIS_TTL }
  );

  return record.text;
}

/** Lo que devuelve una relectura (`POST /agent/documents/:id/reread`). */
export interface RelecturaDeFuente {
  /**
   * Si el texto cambió. Sin cambio el resumen sigue valiendo, y una página web
   * ni se toca; un archivo igual se guarda, para registrar la versión del lector.
   */
  changed: boolean;
  before: number;
  after: number;
  pageCount: number | null;
  wordCount: number;
}

/**
 * Vuelve a leer una fuente desde su archivo original, con el lector de hoy.
 *
 * ── Por qué hace falta ───────────────────────────────────────────────────────
 *
 * El texto se extrae al subir y no se vuelve a mirar nunca. Cuando el lector
 * mejora, lo ya subido se queda atrás para siempre — y eso no es hipotético:
 * un organigrama subido el 2026-09-10 a las 17:06 quedó con 104 caracteres
 * porque la lectura por visión se desplegó a las 23:04 del mismo día.
 *
 * Baja el archivo del almacenamiento y lo pasa por `parseDocument`, el MISMO
 * camino que una subida nueva — incluida la decisión de mirarlo. No es una
 * segunda implementación de la extracción: si lo fuera, se separaría de la
 * primera en el próximo cambio.
 *
 * No crea una fuente nueva: reemplaza el texto de la que ya está. El curso que
 * la cita, su lugar en el panel y su original siguen siendo los mismos.
 *
 * Una página web se relee bajándola de nuevo, fresca (ver `releerPaginaWeb`).
 * Antes se rechazaba con «se relee agregándola de nuevo», que era justo lo que
 * la caché de 7 días impedía: la planilla recién compartida seguía volviendo
 * como el muro de inicio de sesión de la primera vez.
 */
export async function releerFuente(params: {
  documentId: string;
  courseId: string;
  redis: RedisClient;
  /**
   * La empresa desde la que se pide. Sólo la usa una página web: la caché del
   * lector es por empresa. Sin ella se deduce del curso.
   */
  orgId?: string;
  /** Quién la pidió: se le cobra el resumen del texto nuevo. */
  userId?: string;
}): Promise<RelecturaDeFuente> {
  const doc = await getCourseSource(params.documentId, params.courseId);

  if (!doc) throw new AppError('Source not found in this course', 'DOCUMENT_NOT_FOUND', 404);

  if (!doc.assetId && doc.sourceUrl) return releerPaginaWeb(doc, doc.sourceUrl, params);

  const bytes = await bajarArchivoOriginal(doc);
  const archivo = new File([bytes], doc.fileName, { type: doc.mimeType });
  const leido = await parseDocument(archivo);
  const contentHash = computeContentHash(leido.text);
  const changed = contentHash !== hashDeLaFuente(doc);

  // Se guarda aunque el texto sea el mismo: la versión del lector sí cambió, y
  // es lo que deja de marcarla como «leída con un lector viejo».
  await actualizarLecturaDeFuente(params.documentId, {
    text: leido.text,
    wordCount: leido.wordCount,
    pageCount: leido.pageCount,
    contentHash,
    extractorVersion: EXTRACTOR_VERSION
  });

  if (changed) {
    // La copia caliente describe el texto viejo. El resumen viejo no hace falta
    // borrarlo —su clave lleva el hash del texto anterior—; se pide el nuevo.
    await params.redis.del(agentDocumentKey(params.documentId));

    encolarResumen({
      documentId: params.documentId,
      contentHash,
      texto: leido.text,
      redis: params.redis,
      consumo: { userId: params.userId, courseId: params.courseId }
    });
  }

  return {
    changed,
    before: doc.text.length,
    after: leido.text.length,
    pageCount: leido.pageCount,
    wordCount: leido.wordCount
  };
}

/**
 * Los bytes del archivo que se subió como fuente, bajados del almacenamiento.
 *
 * Lo usan releer una fuente y la consulta de planillas, que necesita el libro
 * entero y no el mapa que quedó como texto.
 */
export async function bajarArchivoOriginal(doc: Pick<ChatDocumentRecord, 'assetId'>): Promise<Buffer<ArrayBuffer>> {
  if (!doc.assetId) {
    throw new AppError('This source has no stored file nor web address to re-read', 'SOURCE_HAS_NO_FILE', 400);
  }

  const [asset] = await getAssetsByIds([doc.assetId]);

  if (!asset?.storageKey) {
    throw new AppError('The original file is no longer in storage', 'SOURCE_FILE_MISSING', 410);
  }

  const descarga = await getFromS3({ Bucket: getStorageConfig().bucketDocuments, Key: asset.storageKey });

  if (!descarga.success || !descarga.data?.Body) {
    throw new AppError('Could not read the original file from storage', 'SOURCE_FILE_UNREADABLE', 502);
  }

  return Buffer.from(await descarga.data.Body.transformToByteArray());
}

/** El hash con que se guardó el texto de una fuente; las filas viejas no lo tienen y se calcula. */
function hashDeLaFuente(doc: Pick<ChatDocumentRecord, 'contentHash' | 'text'>): string {
  return doc.contentHash || computeContentHash(doc.text);
}

/**
 * Relee una página web: la baja fresca, la revisa y, si cambió, la reemplaza.
 *
 * Fresca quiere decir que no sale de ninguna caché —ni la nuestra ni la del
 * lector— y que lo leído queda como la nueva copia guardada. Lo que no sirve
 * como fuente (un muro de inicio de sesión, un error del sitio, una página de
 * puros enlaces) se rechaza con 422 y la fuente queda como estaba: reemplazar
 * una lectura buena por un muro sería peor que no releer.
 */
async function releerPaginaWeb(
  doc: ChatDocumentRecord,
  direccion: string,
  params: { courseId: string; redis: RedisClient; orgId?: string; userId?: string }
): Promise<RelecturaDeFuente> {
  const orgId = params.orgId || (await getCourseOrganizationId(params.courseId));

  if (!orgId) throw new AppError('Course not found', 'COURSE_NOT_FOUND', 404);

  const page = await fetchDocumentationUrl({
    url: direccion,
    orgId,
    courseId: params.courseId,
    // Una relectura pedida por la docente no es el agente dando vueltas: el
    // tope de lecturas por conversación no aplica, igual que en Fuentes.
    priorMessages: [],
    fresco: true,
    plazoMs: PLAZO_DE_LECTURA_A_MANO_MS
  });

  const diagnostico = diagnosticarFuente(page.content);

  if (diagnostico) throw errorDePaginaSinContenido(diagnostico, direccion);

  const pagina = prepararPaginaWeb({ url: direccion, pageTitle: page.pageTitle, markdown: page.content });
  const changed = pagina.contentHash !== hashDeLaFuente(doc);

  if (changed) {
    await reemplazarLecturaWeb(doc.id, doc.fileName, pagina, params.redis, {
      userId: params.userId,
      courseId: params.courseId
    });
  }

  return {
    changed,
    before: doc.text.length,
    after: changed ? pagina.text.length : doc.text.length,
    pageCount: null,
    wordCount: changed ? pagina.wordCount : doc.wordCount
  };
}

const DOCUMENT_SUMMARY_EXCERPT_CHARS = 1_500;

/**
 * El resumen corto de un documento, sin esperar nunca al modelo.
 *
 * Lo usan el paquete de fuentes (para lo que no entra en el presupuesto) y el
 * contexto de los documentos de turnos anteriores, y los dos corren ANTES de
 * que el chat mande las cabeceras: esperar acá una llamada al modelo era dejar
 * al navegador sin respuesta, que es como se llegó a los 38 s y al «Request
 * timeout». Si el resumen ya existe se devuelve; si no, se pide en segundo
 * plano (`encolarResumen`) y este turno se arregla con el principio del texto.
 * El próximo ya lo encuentra.
 *
 * El texto se lee primero, y no el resumen, porque la clave del resumen lleva
 * el hash del texto: así un resumen nunca describe una versión vieja. De paso,
 * quien no puede leer el documento tampoco recibe su resumen.
 */
export async function getDocumentSummary(
  documentId: string,
  redis: RedisClient,
  /**
   * Cómo se consigue el texto. Se pasa desde afuera, y no un `userId`, porque
   * el alcance depende de quién pregunta: el chat lee lo del usuario, el índice
   * y el paquete leen lo del curso. Con un `userId` adentro, esta función
   * elegía por ellos — y elegía mal para dos de los tres.
   */
  leerTexto: () => Promise<string | null>,
  /** A quién cobrarle el resumen si hay que generarlo; sin esto, a quien subió la fuente. */
  consumo?: ConsumoDelResumen
): Promise<string | null> {
  const text = await leerTexto();

  if (!text) return null;

  const contentHash = computeContentHash(text);

  try {
    const guardado = (await leerResumenesGuardados(redis, [{ documentId, contentHash }])).get(documentId);

    if (guardado) return guardado;
  } catch (error) {
    console.error(`[agent.documents] no se pudo leer el resumen de ${documentId}:`, error);
  }

  encolarResumen({ documentId, contentHash, texto: text, redis, consumo });

  // Mientras tanto, el principio del texto: mejor que nada, y no se guarda, así
  // que el resumen de verdad lo reemplaza apenas exista.
  return text.slice(0, DOCUMENT_SUMMARY_EXCERPT_CHARS);
}

// ─── Extraction Helpers ──────────────────────────────────────────────────────

/** Por qué no se pudo leer una planilla, con el código que el panel traduce. */
const CODIGOS_DE_PLANILLA: Record<MotivoIlegible, string> = {
  protegido: 'SPREADSHEET_PROTECTED',
  'no-es-xlsx': 'SPREADSHEET_INVALID',
  'muy-grande': 'SPREADSHEET_TOO_LARGE'
};

async function extractSpreadsheetMap(buffer: Buffer, fileName: string): Promise<{ text: string; pageCount: number }> {
  try {
    const libro = await leerLibro(buffer);
    return { text: mapaDelLibro(libro, fileName), pageCount: libro.hojas.length };
  } catch (error) {
    if (error instanceof PlanillaIlegibleError) {
      throw new AppError(error.message, CODIGOS_DE_PLANILLA[error.motivo], 422);
    }
    throw error;
  }
}

async function extractPdfText(buffer: Buffer): Promise<{ text: string; pageCount: number }> {
  const pdfParse = (await import('pdf-parse')).default;
  const result = await pdfParse(buffer);

  return { text: result.text, pageCount: result.numpages };
}

async function extractDocxText(buffer: Buffer): Promise<string> {
  const mammoth = await import('mammoth');
  const result = await mammoth.extractRawText({ buffer });

  return result.value;
}

async function extractPptxText(buffer: Buffer): Promise<{ text: string; pageCount: number }> {
  // pptx-parser may not be available yet — use a simpler approach
  // For now, try to use officegen or a basic XML extraction
  try {
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(buffer);

    const slideTexts: string[] = [];
    const slideFiles = Object.keys(zip.files)
      .filter((name) => name.match(/^ppt\/slides\/slide\d+\.xml$/))
      .sort();

    for (const slideFile of slideFiles) {
      const content = await zip.files[slideFile].async('text');
      // Extract text from XML by stripping tags
      const textContent = content
        .replace(/<a:t[^>]*>/g, '')
        .replace(/<\/a:t>/g, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

      if (textContent) {
        slideTexts.push(textContent);
      }
    }

    return { text: slideTexts.join('\n\n---\n\n'), pageCount: slideFiles.length };
  } catch {
    throw new AppError('Failed to parse PPTX file', 'PPTX_PARSE_ERROR', 422);
  }
}
