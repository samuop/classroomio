import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import * as schema from '@db/schema';
import { db } from '@db/drizzle';

/**
 * Cap on how many documents we keep per conversation. Older ones get pruned on
 * insert.
 *
 * **Why this is 40 and not 10.** The prune deletes the OLDEST rows, and every
 * source a teacher adds from the wizard or the Sources panel lands in the same
 * hidden "Course sources" conversation. Web research adds up to 20 pages in one
 * go; with the old cap of 10, a deep run on a course that already had an
 * uploaded PDF deleted that PDF — it was inserted first, so it pruned first.
 * The teacher would have watched the agent build a course from web pages while
 * their own material was silently dropped from the database.
 *
 * The cap was never the thing protecting the model's context anyway: the source
 * pack has its own token budget (AGENT_SOURCE_PACK_BUDGET, 300k by default) and
 * degrades overflow to summaries instead of destroying rows. This number only
 * bounds storage growth per conversation, so it can be generous.
 */
export const MAX_DOCUMENTS_PER_CONVERSATION = (() => {
  const raw = process.env.AGENT_MAX_DOCUMENTS_PER_CONVERSATION?.trim();
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;

  return Number.isFinite(parsed) && parsed > 0 ? parsed : 40;
})();

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
}): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      await tx.insert(schema.aiChatDocument).values(record);

      const all = await tx
        .select({ id: schema.aiChatDocument.id })
        .from(schema.aiChatDocument)
        .where(eq(schema.aiChatDocument.conversationId, record.conversationId))
        .orderBy(desc(schema.aiChatDocument.createdAt));

      if (all.length > MAX_DOCUMENTS_PER_CONVERSATION) {
        const toDelete = all.slice(MAX_DOCUMENTS_PER_CONVERSATION).map((row) => row.id);

        await tx.delete(schema.aiChatDocument).where(inArray(schema.aiChatDocument.id, toDelete));
      }
    });
  } catch (error) {
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
 * List every document in the course regardless of owner — used by the Sources
 * panel to show "shared" sources (uploaded by another user of the same course).
 * Cross-user: returns docs from all users in the course.
 */
export async function listChatDocumentsByCourseAllUsers(
  courseId: string
): Promise<ChatDocumentRecord[]> {
  try {
    return await db
      .select()
      .from(schema.aiChatDocument)
      .where(eq(schema.aiChatDocument.courseId, courseId))
      .orderBy(desc(schema.aiChatDocument.createdAt));
  } catch (error) {
    console.error('listChatDocumentsByCourseAllUsers error:', error);
    throw new Error('Failed to list chat documents by course (all users)');
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
