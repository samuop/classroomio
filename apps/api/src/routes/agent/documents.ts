import { Hono } from '@api/utils/hono';
import { authMiddleware } from '@api/middlewares/auth';
import { orgMemberMiddleware } from '@api/middlewares/org-member';
import { zValidator } from '@hono/zod-validator';
import {
  ZAgentDocumentsQuery,
  ZAgentDocumentParam
} from '@cio/utils/validation/agent';
import { handleError, AppError } from '@api/utils/errors';
import { isCourseTeamMemberOrOrgAdmin } from '@cio/db/queries/group';
import {
  listChatDocumentsByCourse,
  listChatDocumentsByConversation,
  deleteChatDocument,
  getChatDocumentCacheKey,
  type ChatDocumentRecord
} from '@cio/db/queries/agent/chat-document';
import {
  releaseDocumentCaches,
  getDocumentCacheStatus,
  refreshDocumentCache,
  reconcileCourseSourceCache,
  type ReconcileResult
} from '@api/services/agent/document-cache';
import { redis } from '@api/utils/redis/redis';
import { getDocumentText } from '@api/services/agent/document';

/**
 * Sources / documents sub-router.
 *
 * The "Sources" panel on the course sidebar (between Contenido and Envíos)
 * surfaces every document the teacher has uploaded to the AI assistant for this
 * course, across every conversation. Upload happens elsewhere (POST /agent/upload
 * on agent.ts — the existing endpoint already stores the file in S3, the parsed
 * text in ai_chat_document, and a cache handle in Redis). This sub-router owns
 * the READ-side and DELETE-side of that flow.
 *
 * Auto-sync (Phase 4): the delete handler invalidates the document cache via
 * releaseDocumentCaches so stale handles don't outlive their source.
 *
 * Nothing here CREATES a cache handle for the Anthropic-compatible provider,
 * and nothing may: that API has no cache-status endpoint, so the only proof a
 * cache exists is `usage.cacheReadTokens` on a real chat turn, recorded by
 * agent.ts via recordAnthropicCacheHit. Endpoints that fabricated a handle are
 * what made the Sources badge light up merely from opening the panel.
 */
export const agentDocumentsRouter = new Hono()
  /**
   * GET /agent/documents?courseId=...&conversationId=...
   *
   * List sources for a course. When `conversationId` is set, scopes to that
   * conversation; otherwise returns every document the user has uploaded to the
   * course across all conversations. Each entry is a metadata-only record (no
   * full text body) — the dashboard hits /preview or the chat context loader
   * when it actually needs the body.
   */
  .get(
    '/',
    authMiddleware,
    orgMemberMiddleware,
    zValidator('query', ZAgentDocumentsQuery),
    async (c) => {
      try {
        const user = c.get('user')!;
        const { courseId, conversationId } = c.req.valid('query');

        const allowed = await isCourseTeamMemberOrOrgAdmin(courseId, user.id);
        if (!allowed) {
          throw new AppError('Not authorized for this course', 'COURSE_FORBIDDEN', 403);
        }

        const documents = conversationId
          ? await listChatDocumentsByConversation(conversationId, user.id)
          : await listChatDocumentsByCourse(courseId, user.id);

        // Strip the full text body from the response — it's potentially 500KB
        // per doc and the dashboard only needs metadata for the list view.
        // The chat loader reads it directly from DB via getDocumentText when
        // it actually injects context.
        const data = documents.map((d: ChatDocumentRecord) => ({
          id: d.id,
          conversationId: d.conversationId,
          courseId: d.courseId,
          assetId: d.assetId,
          fileName: d.fileName,
          mimeType: d.mimeType,
          wordCount: d.wordCount,
          pageCount: d.pageCount,
          createdAt: d.createdAt
        }));

        return c.json({ success: true as const, data });
      } catch (error) {
        return handleError(c, error, 'Failed to list documents');
      }
    }
  )

  /**
   * DELETE /agent/documents/:documentId
   *
   * Remove a source. Drops the DB row (and the S3 asset via the asset service
   * if linked) and releases any cache handle so the next chat turn doesn't try
   * to read from a cached block that no longer maps to a real document.
   */
  .delete(
    '/:documentId',
    authMiddleware,
    orgMemberMiddleware,
    zValidator('param', ZAgentDocumentParam),
    async (c) => {
      try {
        const user = c.get('user')!;
        const { documentId } = c.req.valid('param');

        const result = await deleteChatDocument(documentId, user.id);
        if (!result) {
          throw new AppError('Document not found', 'DOCUMENT_NOT_FOUND', 404);
        }

        // Drop the cache handle (Redis only — the server-side cache in Gemini
        // expires on its TTL). If a fresh upload later re-uses the same id
        // (nanoid collision is astronomically unlikely) the next chat will
        // simply rebuild the cache.
        await releaseDocumentCaches([documentId], redis);

        return c.json({
          success: true as const,
          data: { id: documentId, assetId: result.assetId }
        });
      } catch (error) {
        return handleError(c, error, 'Failed to delete document');
      }
    }
  )

  /**
   * POST /agent/documents/reconcile
   *
   * The auto-sync sub-agent's public surface. Walks every document the
   * user owns in the given course, rebuilds cache handles that are missing
   * or expired, and returns a per-document report so the Sources panel can
   * show what changed. Safe to call as often as you like (idempotent) and
   * best-effort: one bad document doesn't poison the whole pass.
   */
  .post(
    '/reconcile',
    authMiddleware,
    orgMemberMiddleware,
    zValidator('query', ZAgentDocumentsQuery),
    async (c) => {
      try {
        const user = c.get('user')!;
        const { courseId } = c.req.valid('query');

        const allowed = await isCourseTeamMemberOrOrgAdmin(courseId, user.id);
        if (!allowed) {
          throw new AppError('Not authorized for this course', 'COURSE_FORBIDDEN', 403);
        }

        const documents = await listChatDocumentsByCourse(courseId, user.id);

        // Pull the full text for each document so the reconciler can
        // re-classify size eligibility. The text isn't returned to the
        // client (too big); only the per-document reconcile report goes
        // back over the wire.
        const documentsWithText = await Promise.all(
          documents.map(async (d) => ({
            id: d.id,
            updatedAt: d.createdAt,
            text: (await getDocumentText(d.id, user.id, redis)) ?? ''
          }))
        );

        const results: ReconcileResult[] = await reconcileCourseSourceCache(
          documentsWithText,
          redis
        );

        return c.json({
          success: true as const,
          data: {
            totalDocuments: documents.length,
            rebuilt: results.filter((r) => r.action === 'rebuilt').length,
            kept: results.filter((r) => r.action === 'kept').length,
            released: results.filter((r) => r.action === 'released').length,
            skipped: results.filter((r) => r.action === 'skipped').length,
            results
          }
        });
      } catch (error) {
        return handleError(c, error, 'Failed to reconcile sources');
      }
    }
  )

  /**
   * GET /agent/documents/:documentId/cache-status
   *
   * Returns whether the document currently has a live cache handle (so the
   * next chat turn will read it at ~10% of the input price) and how much time
   * remains on the handle. Cheap: a single Redis GET.
   */
  .get(
    '/:documentId/cache-status',
    authMiddleware,
    orgMemberMiddleware,
    zValidator('param', ZAgentDocumentParam),
    async (c) => {
      try {
        const user = c.get('user')!;
        const { documentId } = c.req.valid('param');

        // Auth: confirm the document belongs to this user OR is shared
        // across users in the same course (multi-user shared cache).
        const cacheKey = await getChatDocumentCacheKey(documentId);
        if (!cacheKey) {
          throw new AppError('Document not found', 'DOCUMENT_NOT_FOUND', 404);
        }
        const owned = await listChatDocumentsByCourse(cacheKey.courseId, user.id);
        if (!owned.some((d) => d.id === documentId)) {
          throw new AppError('Document not found', 'DOCUMENT_NOT_FOUND', 404);
        }

        const status = await getDocumentCacheStatus(
          documentId,
          redis,
          cacheKey.courseId,
          cacheKey.contentHash ?? undefined
        );
        return c.json({ success: true as const, data: status });
      } catch (error) {
        return handleError(c, error, 'Failed to read cache status');
      }
    }
  )

  /**
   * POST /agent/documents/:documentId/refresh-cache
   *
   * Drop the current cache handle and create a fresh one. Idempotent: the
   * next chat turn will pick up the new handle automatically. Useful when
   * the document text has been re-uploaded/edited out-of-band (e.g. the
   * instructor fixed a typo in the underlying file but kept the same
   * documentId) and the instructor wants to force a cache rebuild without
   * sending a throwaway chat turn.
   */
  .post(
    '/:documentId/refresh-cache',
    authMiddleware,
    orgMemberMiddleware,
    zValidator('param', ZAgentDocumentParam),
    async (c) => {
      try {
        const user = c.get('user')!;
        const { documentId } = c.req.valid('param');

        const cacheKey = await getChatDocumentCacheKey(documentId);
        if (!cacheKey) {
          throw new AppError('Document not found', 'DOCUMENT_NOT_FOUND', 404);
        }
        const owned = await listChatDocumentsByCourse(cacheKey.courseId, user.id);
        if (!owned.some((d) => d.id === documentId)) {
          throw new AppError('Document not found', 'DOCUMENT_NOT_FOUND', 404);
        }

        const status = await refreshDocumentCache(
          documentId,
          redis,
          cacheKey.courseId,
          cacheKey.contentHash ?? undefined
        );
        return c.json({ success: true as const, data: status });
      } catch (error) {
        return handleError(c, error, 'Failed to refresh cache');
      }
    }
  );