import { Hono } from '@api/utils/hono';
import { authMiddleware } from '@api/middlewares/auth';
import { orgMemberMiddleware } from '@api/middlewares/org-member';
import { zValidator } from '@hono/zod-validator';
import {
  ZAgentHistoryQuery,
  ZAgentConversationParam,
  ZAgentConversationCreateBody,
  ZAgentHistorySaveBody,
  ZAgentHistoryRenameBody,
  ZAgentHistoryDeleteParam,
  ZAgentGenerateTitleParam,
  ZAgentGenerateTitleBody
} from '@cio/utils/validation/agent';
import { handleError, AppError } from '@api/utils/errors';
import {
  listChatConversations,
  getChatConversation,
  createChatConversation,
  saveChatMessages,
  deleteChatConversation,
  updateConversationTitle
} from '@api/services/agent/chat-history';
import { compactConversation } from '@api/services/agent/compact';
import { generateConversationTitle } from '@api/services/agent/title-generation';
import { pickAnyConfiguredProvider } from '@cio/ai-assistant/providers';
import { collectDocumentIds } from '@api/services/agent/chat-context';
import { releaseDocumentCaches } from '@api/services/agent/document-cache';
import { redis } from '@api/utils/redis/redis';

export const agentHistoryRouter = new Hono()
  /**
   * GET /agent/history?courseId=...
   * List all conversations for the current user in a course.
   */
  .get('/', authMiddleware, orgMemberMiddleware, zValidator('query', ZAgentHistoryQuery), async (c) => {
    try {
      const user = c.get('user')!;
      const { courseId } = c.req.valid('query');

      const conversations = await listChatConversations(courseId, user.id);

      return c.json({ success: true as const, data: conversations });
    } catch (error) {
      return handleError(c, error, 'Failed to list conversations');
    }
  })

  /**
   * GET /agent/history/:conversationId
   * Get a single conversation with its messages.
   */
  .get(
    '/:conversationId',
    authMiddleware,
    orgMemberMiddleware,
    zValidator('param', ZAgentConversationParam),
    async (c) => {
      try {
        const user = c.get('user')!;
        const { conversationId } = c.req.valid('param');

        const conversation = await getChatConversation(conversationId, user.id);

        if (!conversation) {
          return c.json({ success: false, error: 'Conversation not found' }, 404);
        }

        return c.json({ success: true as const, data: conversation });
      } catch (error) {
        return handleError(c, error, 'Failed to fetch conversation');
      }
    }
  )

  /**
   * POST /agent/history
   * Create a new conversation.
   */
  .post('/', authMiddleware, orgMemberMiddleware, zValidator('json', ZAgentConversationCreateBody), async (c) => {
    try {
      const user = c.get('user')!;
      const { courseId, title } = c.req.valid('json');

      const conversation = await createChatConversation(courseId, user.id, title);

      return c.json({ success: true as const, data: conversation }, 201);
    } catch (error) {
      return handleError(c, error, 'Failed to create conversation');
    }
  })

  /**
   * PUT /agent/history/:conversationId
   * Save messages to a conversation.
   */
  .put(
    '/:conversationId',
    authMiddleware,
    orgMemberMiddleware,
    zValidator('param', ZAgentConversationParam),
    zValidator('json', ZAgentHistorySaveBody),
    async (c) => {
      try {
        const user = c.get('user')!;
        const { conversationId } = c.req.valid('param');
        const { messages, title } = c.req.valid('json');

        await saveChatMessages(conversationId, user.id, messages, title);

        // Wizard drafts are promoted to course sources on the chat turn itself
        // (see /agent/chat), which is the only moment early enough to matter:
        // the source pack that carries the material to the model is assembled
        // from the database at the START of the turn. Doing it here as well
        // would only persist material the turn already ran without.

        return c.json({ success: true as const });
      } catch (error) {
        return handleError(c, error, 'Failed to save messages');
      }
    }
  )

  /**
   * PATCH /agent/history/:conversationId
   * Rename a conversation without re-uploading messages.
   */
  .patch(
    '/:conversationId',
    authMiddleware,
    orgMemberMiddleware,
    zValidator('param', ZAgentConversationParam),
    zValidator('json', ZAgentHistoryRenameBody),
    async (c) => {
      try {
        const user = c.get('user')!;
        const { conversationId } = c.req.valid('param');
        const { title } = c.req.valid('json');

        const conversation = await getChatConversation(conversationId, user.id);

        if (!conversation) {
          return c.json({ success: false as const, error: 'Conversation not found' }, 404);
        }

        await updateConversationTitle(conversationId, user.id, title);

        return c.json({ success: true as const, data: { id: conversationId, title } });
      } catch (error) {
        return handleError(c, error, 'Failed to rename conversation');
      }
    }
  )

  /**
   * DELETE /agent/history/:conversationId
   * Delete a conversation.
   */
  .delete(
    '/:conversationId',
    authMiddleware,
    orgMemberMiddleware,
    zValidator('param', ZAgentHistoryDeleteParam),
    async (c) => {
      try {
        const user = c.get('user')!;
        const { conversationId } = c.req.valid('param');

        // Release any Gemini document caches owned by this conversation BEFORE
        // deleting it (afterwards the attachment metadata is gone). Best-effort —
        // an error here must never block the deletion itself.
        try {
          const conversation = await getChatConversation(conversationId, user.id);
          const documentIds = collectDocumentIds((conversation?.messages as unknown[]) ?? []);
          if (documentIds.length > 0) {
            await releaseDocumentCaches(documentIds, redis);
          }
        } catch (err) {
          console.error('[agent.history] failed to release document caches on delete:', err);
        }

        await deleteChatConversation(conversationId, user.id);

        return c.json({ success: true as const });
      } catch (error) {
        return handleError(c, error, 'Failed to delete conversation');
      }
    }
  )

  /**
   * POST /agent/history/:conversationId/compact
   * Summarize and replace persisted messages with a single seed message.
   */
  .post(
    '/:conversationId/compact',
    authMiddleware,
    orgMemberMiddleware,
    zValidator('param', ZAgentConversationParam),
    async (c) => {
      try {
        const user = c.get('user')!;
        const { conversationId } = c.req.valid('param');
        const data = await compactConversation(conversationId, user.id);

        return c.json({ success: true as const, data });
      } catch (error) {
        return handleError(c, error, 'Failed to compact conversation');
      }
    }
  )

  /**
   * POST /agent/history/:conversationId/generate-title
   * Generate a short title from the first user message using a cheap model.
   */
  .post(
    '/:conversationId/generate-title',
    authMiddleware,
    orgMemberMiddleware,
    zValidator('param', ZAgentGenerateTitleParam),
    zValidator('json', ZAgentGenerateTitleBody),
    async (c) => {
      try {
        const user = c.get('user')!;
        const { conversationId } = c.req.valid('param');
        const { firstMessageText } = c.req.valid('json');

        const providerConfig = pickAnyConfiguredProvider();
        if (!providerConfig) {
          throw new AppError('AI assistant is not configured', 'AI_NOT_CONFIGURED', 503);
        }

        let title: string;
        try {
          title = await generateConversationTitle(firstMessageText, providerConfig);
        } catch {
          title = firstMessageText.slice(0, 60).trim();
        }

        await updateConversationTitle(conversationId, user.id, title);

        return c.json({ success: true as const, data: { title } });
      } catch (error) {
        return handleError(c, error, 'Failed to generate title');
      }
    }
  );
