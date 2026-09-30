import { and, count, desc, eq, inArray, sql } from 'drizzle-orm';
import * as schema from '@db/schema';
import { db } from '@db/drizzle';

/**
 * Cuántas fuentes puede tener un curso.
 *
 * ── Por qué un tope que RECHAZA y no una poda ────────────────────────────────
 *
 * Antes había un tope de 40 documentos por conversación que, al pasarse, BORRABA
 * los más viejos en silencio. Mientras cada fuente abría su propia conversación
 * no mordía; desde que todas las fuentes del panel de un curso van a una sola
 * conversación oculta, dos investigaciones profundas y una subida ya borraban el
 * PDF de la docente —el más viejo— sin que nadie se enterara.
 *
 * La regla ahora es la del dueño: una fuente no se borra nunca si la docente no
 * lo pide. Pasado el tope, la fuente nueva se rechaza con un mensaje claro y la
 * docente decide cuál sacar.
 *
 * El tope no protege el contexto del modelo: para eso están el presupuesto del
 * paquete de fuentes (AGENT_SOURCE_PACK_BUDGET) y el de la caché, que degradan a
 * resúmenes sin borrar nada. Esto sólo acota lo que se guarda por curso.
 */
export const MAX_SOURCES_PER_COURSE = (() => {
  const raw = process.env.AGENT_MAX_SOURCES_PER_COURSE?.trim();
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;

  return Number.isFinite(parsed) && parsed > 0 ? parsed : 100;
})();

/** El código con que la API rechaza una fuente de más (422). */
export const CODIGO_TOPE_DE_FUENTES = 'SOURCE_LIMIT_REACHED';

/** El curso ya tiene `MAX_SOURCES_PER_COURSE` fuentes: la nueva no se guarda. */
export class TopeDeFuentesError extends Error {
  readonly code = CODIGO_TOPE_DE_FUENTES;

  constructor(readonly tope: number) {
    super(`This course already has ${tope} sources`);
    this.name = 'TopeDeFuentesError';
  }
}

/**
 * Si un error es el del tope de fuentes, venga suelto o envuelto (Drizzle
 * envuelve lo que tira adentro de una transacción en su `cause`).
 */
export function esTopeDeFuentes(error: unknown): error is TopeDeFuentesError {
  const conCodigo = (valor: unknown) =>
    !!valor && typeof valor === 'object' && (valor as { code?: unknown }).code === CODIGO_TOPE_DE_FUENTES;

  return conCodigo(error) || conCodigo((error as { cause?: unknown } | null)?.cause);
}

/** Cuántas fuentes tiene un curso, de todas las personas del equipo. */
export async function contarFuentesDelCurso(courseId: string): Promise<number> {
  try {
    const [fila] = await db
      .select({ cantidad: count() })
      .from(schema.aiChatDocument)
      .where(eq(schema.aiChatDocument.courseId, courseId));

    return Number(fila?.cantidad ?? 0);
  } catch (error) {
    console.error('contarFuentesDelCurso error:', error);
    throw new Error('Failed to count course sources');
  }
}

export interface ChatDocumentRecord {
  id: string;
  conversationId: string;
  courseId: string;
  userId: string;
  assetId: string | null;
  /** La direccion de la pagina, cuando la fuente salio de la web.
   *
   * Es excluyente con `assetId`: si el original lo subio alguien, la copia es
   * nuestra y vive en el almacenamiento; si salio de internet, no guardamos
   * copia y lo unico que queda es la direccion. Null en las filas viejas, que
   * se crearon antes de que la guardaramos.
   */
  sourceUrl: string | null;
  fileName: string;
  mimeType: string;
  text: string;
  /** SHA-256 of the extracted text. Two users uploading the same PDF to the
   * same course end up with the same contentHash so the Sources panel can
   * deduplicate and share the cache handle. Nullable for legacy rows. */
  contentHash: string | null;
  wordCount: number;
  pageCount: number | null;
  /** Versión del lector con la que se sacó `text`. 0 = antes de que existiera. */
  extractorVersion: number;
  createdAt: string;
}

export async function createChatDocument(record: {
  id: string;
  conversationId: string;
  courseId: string;
  userId: string;
  assetId: string | null;
  sourceUrl?: string | null;
  fileName: string;
  mimeType: string;
  text: string;
  contentHash?: string | null;
  wordCount: number;
  pageCount: number | null;
  extractorVersion?: number;
}): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      // Las altas del mismo curso, de a una: sin esto, dos altas a la vez con el
      // curso en 99 cuentan 99 las dos y quedan 101.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${record.courseId}))`);

      const [fila] = await tx
        .select({ cantidad: count() })
        .from(schema.aiChatDocument)
        .where(eq(schema.aiChatDocument.courseId, record.courseId));

      if (Number(fila?.cantidad ?? 0) >= MAX_SOURCES_PER_COURSE) {
        throw new TopeDeFuentesError(MAX_SOURCES_PER_COURSE);
      }

      await tx.insert(schema.aiChatDocument).values(record);
    });
  } catch (error) {
    // El tope no es una falla: quien llama lo convierte en el 422 que la
    // docente ve con su texto.
    if (esTopeDeFuentes(error)) throw new TopeDeFuentesError(MAX_SOURCES_PER_COURSE);

    console.error('createChatDocument error:', error);
    throw new Error('Failed to persist chat document');
  }
}

/**
 * Look up an existing document in the same course with the same contentHash.
 * Used by the upload endpoint to deduplicate: if Alice already uploaded
 * `apuntes.pdf` to course X and Bob uploads the same file, we return
 * Alice's documentId instead of creating a duplicate row + asset.
 *
 * Returns the cached document if found, else null.
 */
export async function findChatDocumentByContentHash(
  courseId: string,
  contentHash: string
): Promise<ChatDocumentRecord | null> {
  try {
    const [row] = await db
      .select()
      .from(schema.aiChatDocument)
      .where(
        and(
          eq(schema.aiChatDocument.courseId, courseId),
          eq(schema.aiChatDocument.contentHash, contentHash)
        )
      )
      .orderBy(desc(schema.aiChatDocument.createdAt))
      .limit(1);

    return row ?? null;
  } catch (error) {
    console.error('findChatDocumentByContentHash error:', error);
    throw new Error('Failed to find chat document by contentHash');
  }
}

/**
 * Reemplaza el texto de una fuente con una lectura nueva del mismo archivo.
 *
 * No crea una fila ni toca el original: la fuente sigue siendo la misma, lo que
 * cambia es cuánto pudimos leer de ella. Por eso se conservan `id`, `assetId` y
 * `createdAt` — el curso que la cita, la caché que la referencia y el orden del
 * panel siguen valiendo.
 */
export async function actualizarLecturaDeFuente(
  documentId: string,
  lectura: { text: string; wordCount: number; pageCount: number | null; contentHash: string | null; extractorVersion: number }
): Promise<void> {
  try {
    await db.update(schema.aiChatDocument).set(lectura).where(eq(schema.aiChatDocument.id, documentId));
  } catch (error) {
    console.error('actualizarLecturaDeFuente error:', error);
    throw new Error('Failed to update course source extraction');
  }
}

export async function getChatDocument(documentId: string, userId: string): Promise<ChatDocumentRecord | null> {
  try {
    const [row] = await db
      .select()
      .from(schema.aiChatDocument)
      .where(and(eq(schema.aiChatDocument.id, documentId), eq(schema.aiChatDocument.userId, userId)))
      .limit(1);

    return row ?? null;
  } catch (error) {
    console.error('getChatDocument error:', error);
    throw new Error('Failed to fetch chat document');
  }
}

/**
 * Lightweight lookup: just the `courseId` and `contentHash` of a chat document.
 * Used by the cache endpoints to compute the shared (course, hash) Redis key.
 */
export async function getChatDocumentCacheKey(
  documentId: string
): Promise<{ courseId: string; contentHash: string | null } | null> {
  try {
    const [row] = await db
      .select({
        courseId: schema.aiChatDocument.courseId,
        contentHash: schema.aiChatDocument.contentHash
      })
      .from(schema.aiChatDocument)
      .where(eq(schema.aiChatDocument.id, documentId))
      .limit(1);
    return row ?? null;
  } catch (error) {
    console.error('getChatDocumentCacheKey error:', error);
    throw new Error('Failed to fetch chat document cache key');
  }
}

/**
 * Lightweight lookup: just the `courseId` of a chat document. Used by the
 * Sources panel to scope cache-status and refresh-cache endpoints to the
 * requesting user's course.
 */
export async function getChatDocumentCourseId(documentId: string): Promise<string | null> {
  try {
    const [row] = await db
      .select({ courseId: schema.aiChatDocument.courseId })
      .from(schema.aiChatDocument)
      .where(eq(schema.aiChatDocument.id, documentId))
      .limit(1);
    return row?.courseId ?? null;
  } catch (error) {
    console.error('getChatDocumentCourseId error:', error);
    throw new Error('Failed to fetch chat document courseId');
  }
}

export async function getChatDocumentsByIds(documentIds: string[]): Promise<ChatDocumentRecord[]> {
  if (documentIds.length === 0) return [];

  try {
    return await db.select().from(schema.aiChatDocument).where(inArray(schema.aiChatDocument.id, documentIds));
  } catch (error) {
    console.error('getChatDocumentsByIds error:', error);
    throw new Error('Failed to fetch chat documents');
  }
}

export async function listChatDocumentsByConversation(
  conversationId: string,
  userId: string
): Promise<ChatDocumentRecord[]> {
  try {
    return await db
      .select()
      .from(schema.aiChatDocument)
      .where(and(eq(schema.aiChatDocument.conversationId, conversationId), eq(schema.aiChatDocument.userId, userId)))
      .orderBy(desc(schema.aiChatDocument.createdAt));
  } catch (error) {
    console.error('listChatDocumentsByConversation error:', error);
    throw new Error('Failed to list chat documents');
  }
}

/**
 * List all documents for a course (across all conversations the user owns in
 * the course). Used by the Sources panel to show every uploaded source for the
 * course, not just the current conversation.
 */
export async function listChatDocumentsByCourse(courseId: string, userId: string): Promise<ChatDocumentRecord[]> {
  try {
    return await db
      .select()
      .from(schema.aiChatDocument)
      .where(and(eq(schema.aiChatDocument.courseId, courseId), eq(schema.aiChatDocument.userId, userId)))
      .orderBy(desc(schema.aiChatDocument.createdAt));
  } catch (error) {
    console.error('listChatDocumentsByCourse error:', error);
    throw new Error('Failed to list chat documents by course');
  }
}

/**
 * Las fuentes del curso, sin mirar quién las subió.
 *
 * ── Por qué el alcance es el curso ───────────────────────────────────────────
 *
 * Una fuente es material del curso, no del archivo personal de quien la subió.
 * Cuando el alcance era el usuario, un segundo docente del mismo curso —o el
 * operador de plataforma— abría el chat y el agente corría SIN NINGUNA fuente,
 * sin que nada lo avisara: el panel también salía vacío, así que ni siquiera se
 * veía la falta. Medido en producción el 2026-09-11: una sección entera escrita
 * a ciegas sobre un organigrama que el agente nunca vio.
 *
 * El permiso no se pierde por esto. Quien llama ya pasó por
 * `isCourseTeamMemberOrOrgAdmin`: el curso ES la frontera de autorización, y
 * esta consulta no hace más que respetarla. Filtrar además por dueño no sumaba
 * seguridad —cualquiera del equipo puede abrir el curso— y sí restaba material.
 *
 * Borrar sigue siendo del dueño (ver `deleteChatDocument`): leer lo del equipo
 * es colaborar, borrarlo es otra cosa.
 */
export async function listCourseSources(courseId: string): Promise<ChatDocumentRecord[]> {
  try {
    return await db
      .select()
      .from(schema.aiChatDocument)
      .where(eq(schema.aiChatDocument.courseId, courseId))
      .orderBy(desc(schema.aiChatDocument.createdAt));
  } catch (error) {
    console.error('listCourseSources error:', error);
    throw new Error('Failed to list course sources');
  }
}

/**
 * Una fuente del curso por id, sin mirar quién la subió.
 *
 * El par de `listCourseSources`: si el índice muestra una fuente, leerla tiene
 * que funcionar. Listar con un alcance y leer con otro deja al agente pidiendo
 * un id que existe y recibiendo "no existe" — el peor error posible, porque se
 * parece a un id inventado.
 *
 * El `courseId` no es decorativo: ata el documento al curso que el llamador ya
 * tiene autorizado, así un id de otro curso no se lee ni por equivocación ni a
 * propósito.
 */
export async function getCourseSource(documentId: string, courseId: string): Promise<ChatDocumentRecord | null> {
  try {
    const [row] = await db
      .select()
      .from(schema.aiChatDocument)
      .where(and(eq(schema.aiChatDocument.id, documentId), eq(schema.aiChatDocument.courseId, courseId)))
      .limit(1);

    return row ?? null;
  } catch (error) {
    console.error('getCourseSource error:', error);
    throw new Error('Failed to fetch course source');
  }
}

/**
 * Hard-delete a chat document. Returns the deleted row's assetId so the caller
 * can also drop the S3 object, or null if nothing was deleted (wrong id, wrong
 * user, already gone).
 */
export async function deleteChatDocument(
  documentId: string,
  userId: string
): Promise<{ assetId: string | null } | null> {
  try {
    const [row] = await db
      .select({ assetId: schema.aiChatDocument.assetId })
      .from(schema.aiChatDocument)
      .where(and(eq(schema.aiChatDocument.id, documentId), eq(schema.aiChatDocument.userId, userId)))
      .limit(1);

    if (!row) return null;

    await db.delete(schema.aiChatDocument).where(eq(schema.aiChatDocument.id, documentId));

    return { assetId: row.assetId };
  } catch (error) {
    console.error('deleteChatDocument error:', error);
    throw new Error('Failed to delete chat document');
  }
}

// Re-export the sql helper so callers can use raw fragments without
// importing drizzle directly. Currently unused but reserved for future
// queries (e.g. content-hash aggregations).
export const rawSql = sql;
