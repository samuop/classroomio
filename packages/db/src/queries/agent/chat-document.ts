import { and, desc, eq, inArray } from 'drizzle-orm';
import * as schema from '@db/schema';
import { db } from '@db/drizzle';

/** Cap on how many documents we keep per conversation. Older ones get pruned on insert. */
const MAX_DOCUMENTS_PER_CONVERSATION = 10;

export interface ChatDocumentRecord {
  id: string;
  conversationId: string;
  courseId: string;
  userId: string;
  assetId: string | null;
  fileName: string;
  mimeType: string;
  text: string;
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
  fileName: string;
  mimeType: string;
  text: string;
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
