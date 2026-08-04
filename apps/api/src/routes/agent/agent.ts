import { Hono } from '@api/utils/hono';
import { authMiddleware } from '@api/middlewares/auth';
import { orgMemberMiddleware } from '@api/middlewares/org-member';
import { orgAdminMiddleware } from '@api/middlewares/org-admin';
import { authOrApiKeyMiddleware } from '@api/middlewares/auth-or-api-key';
import { agentContentTypeRewrite } from '@api/middlewares/agent-content-type';
import { handleError, AppError } from '@api/utils/errors';
import { zValidator } from '@hono/zod-validator';
import {
  streamText,
  generateText,
  stepCountIs,
  convertToModelMessages,
  pruneMessages,
  InvalidToolInputError,
  NoSuchToolError
} from 'ai';
import {
  ZAgentChatBody,
  ZAgentCreditPurchase,
  ZAgentCreditsBody,
  ZAgentGenerateCourseTitleBody,
  ZAgentGenerateTextBody,
  ZAgentResearchBody,
  ZAgentStatusQuery,
  ZAgentSummarizeBody,
  ZTutorUsageQuery,
  ZTutorUsagePeriod,
  ZTutorUsageUserParam
} from '@cio/utils/validation/agent';
import {
  addCredits,
  enforceTokenBalance,
  getDetailedUsage,
  getPurchasedSummary,
  getTeamLeaderboard,
  getTokenBalance,
  isOrgOnPaidPlan,
  recordTokenUsage
} from '@api/services/agent/usage';
import {
  enforceStudentTutorPolicy,
  getStudentTutorStatus,
  getTutorCapStatusSummary,
  getTutorLearnerDetail,
  getTutorLearnerLeaderboard,
  incrementStudentTutorCount
} from '@api/services/agent/tutor-usage';
import { buildStudentAgentTools } from '@api/services/agent/student-tools';
import {
  parseAndStoreDocument,
  parseDocument,
  storeDraftDocument,
  promoteDraftDocuments,
  getDocumentText
} from '@api/services/agent/document';
import { createChatConversation } from '@api/services/agent/chat-history';
import { recordAnthropicCacheHit, resolveDocumentCache } from '@api/services/agent/document-cache';
import { buildSourcePack } from '@api/services/agent/source-pack';
import { runResearch } from '@api/services/agent/research';
import { isWebSearchConfigured, WEB_SEARCH_UNCONFIGURED } from '@api/services/agent/web-search';
import { indexDocument, isDocumentIndexed } from '@api/services/agent/embeddings';
import { recordCreditPurchase } from '@api/services/agent/credit-purchase';
import { generateCourseMeta } from '@api/services/agent/title-generation';
import { generateFieldText } from '@api/services/agent/text-generation';
import { isCourseTeamMemberOrOrgAdmin } from '@cio/db/queries/group';
import {
  getChatConversation,
  getChatDocumentCacheKey,
  readPlanRegistry,
  syncPlanRegistry
} from '@cio/db/queries/agent';
import {
  AgentRole,
  AIProvider,
  MAX_STEPS_PER_ROUND,
  getCourseTemplate,
  resolveAgentContextBudget,
  type AgentContext,
  type AgentStatus,
  type TeacherPromptMode
} from '@cio/ai-assistant';
import { createModel, pickAnyConfiguredProvider } from '@cio/ai-assistant/providers';
import { buildSystemPrompt, buildContextMessage } from '@cio/ai-assistant/prompt';
import { trackAgentEvent, AgentEvent } from '@api/utils/tinybird';
import { redis } from '@api/utils/redis/redis';
import { db } from '@cio/db';
import * as schema from '@cio/db/schema';
import type { TLocale } from '@db/types';
import { eq } from 'drizzle-orm';
import { listCourseSections } from '@api/services/course/section';
import { getCourseContentItems } from '@cio/db/queries/course/content';
import { getLesson } from '@api/services/lesson/lesson';
import { getExercise } from '@api/services/exercise/exercise';
import { sanitizeDanglingToolCalls } from '@api/services/agent/sanitize-tool-calls';
import { measureContextBreakdown } from '@api/services/agent/context-window';
import {
  buildPlanProgressAnchor,
  type PlanProgress,
  collectDocumentIds,
  getActiveCourseTemplateId,
  getLatestImplementationPlan,
  loadDocumentsContext,
  resolveTeacherPromptMode,
  verifyExerciseBelongsToCourse,
  verifyLessonBelongsToCourse
} from '@api/services/agent/chat-context';
import { buildAgentTools } from '@api/services/agent/chat-tools';
import { buildModelContextMessages } from '@api/services/agent/model-context';
import { summarizeConversation } from '@api/services/agent/summarize';
import { agentHistoryRouter } from './history';
import { agentRunsRouter } from './runs';
import { agentDocumentsRouter } from './documents';
import { agentDiagramsRouter } from './diagrams';

/**
 * Read an extended-thinking budget from the environment.
 *
 * Returns 0 — i.e. thinking off — for anything unset, unparseable, or negative,
 * so a typo in the env silently degrades to today's behaviour instead of sending
 * a malformed request to the provider.
 */
function resolveThinkingBudget(envVar: string, fallback: number): number {
  const raw = process.env[envVar]?.trim();
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

const agentCoreRouter = new Hono()
  .get('/status', authMiddleware, orgMemberMiddleware, zValidator('query', ZAgentStatusQuery), async (c) => {
    try {
      const user = c.get('user')!;
      const orgId = c.req.header('cio-org-id')!;
      const { courseId } = c.req.valid('query');

      const providerConfig = pickAnyConfiguredProvider();
      if (!providerConfig) {
        const status: AgentStatus = {
          enabled: false,
          role: AgentRole.STUDENT,
          usage: { used: 0, allowance: 0, creditBalance: 0, remaining: 0 },
          tutor: { enabled: false, capRemaining: null, cap: null, enforced: false },
          contextWindow: resolveAgentContextBudget()
        };

        return c.json({ success: true, data: status });
      }

      const isTeamMember = await isCourseTeamMemberOrOrgAdmin(courseId, user.id);
      const role = isTeamMember ? AgentRole.TEACHER : AgentRole.STUDENT;

      const usage = await getTokenBalance(orgId);

      const tutor =
        role === AgentRole.STUDENT
          ? await getStudentTutorStatus(orgId, courseId, user.id)
          : { enabled: true, cap: null, capRemaining: null, enforced: false };

      const status: AgentStatus = {
        enabled: true,
        role,
        usage,
        tutor,
        contextWindow: resolveAgentContextBudget()
      };

      return c.json({ success: true, data: status });
    } catch (error) {
      return handleError(c, error, 'Failed to get agent status');
    }
  })
  .post('/upload', authMiddleware, orgMemberMiddleware, async (c) => {
    try {
      const user = c.get('user')!;
      const orgId = c.req.header('cio-org-id')!;

      const courseId = c.req.query('courseId');
      if (!courseId) {
        throw new AppError('Course ID is required', 'COURSE_ID_REQUIRED', 400);
      }

      let conversationId = c.req.query('conversationId');

      const isTeamMember = await isCourseTeamMemberOrOrgAdmin(courseId, user.id);
      if (!isTeamMember) {
        throw new AppError('You must be a course team member to upload documents', 'NOT_COURSE_TEAM_MEMBER', 403);
      }

      // When the upload comes from the Sources panel (no conversation yet),
      // create a hidden "Sources" conversation for the document so it has
      // somewhere to live. The chat UI can later adopt or re-parent the
      // document — the document row in ai_chat_document just needs a non-null
      // conversationId to satisfy the FK constraint.
      if (!conversationId) {
        const created = await createChatConversation(courseId, user.id, 'Course sources');
        conversationId = created.id;
      } else {
        const conversation = await getChatConversation(conversationId, user.id);
        if (!conversation || conversation.courseId !== courseId) {
          throw new AppError('Conversation not found', 'CONVERSATION_NOT_FOUND', 404);
        }
      }

      const isPaid = await isOrgOnPaidPlan(orgId);
      if (!isPaid) {
        return c.json(
          {
            success: false,
            error: 'document_upload_requires_upgrade',
            upgradeRequired: true
          },
          403
        );
      }

      const body = await c.req.parseBody();
      const file = body.file;

      if (!(file instanceof File)) {
        throw new AppError('File is required', 'FILE_REQUIRED', 400);
      }

      const result = await parseAndStoreDocument(file, orgId, user.id, courseId, conversationId, redis);

      return c.json({ success: true, data: result });
    } catch (error) {
      if (error instanceof AppError) {
        if (error.statusCode === 413) {
          return c.json({ success: false, error: 'file_too_large', maxSize: 5242880 }, 413);
        }

        if (error.statusCode === 415) {
          return c.json(
            {
              success: false,
              error: 'unsupported_file_type',
              allowed: [
                'application/pdf',
                'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                'application/vnd.openxmlformats-officedocument.presentationml.presentation'
              ]
            },
            415
          );
        }
      }

      return handleError(c, error, 'Failed to upload document');
    }
  })
  .post('/upload-draft', authMiddleware, orgMemberMiddleware, async (c) => {
    // Pre-creation upload for the course wizard: no courseId/conversationId yet.
    // Stores extracted text in Redis only (1h TTL); the wizard passes the
    // returned documentId into the first chat message once the course exists.
    try {
      const user = c.get('user')!;
      const orgId = c.req.header('cio-org-id')!;

      const isPaid = await isOrgOnPaidPlan(orgId);
      if (!isPaid) {
        return c.json({ success: false, error: 'document_upload_requires_upgrade', upgradeRequired: true }, 403);
      }

      const body = await c.req.parseBody();
      const file = body.file;

      if (!(file instanceof File)) {
        throw new AppError('File is required', 'FILE_REQUIRED', 400);
      }

      const parsed = await parseDocument(file);
      const { documentId } = await storeDraftDocument(parsed, user.id, redis);

      return c.json({
        success: true,
        data: {
          documentId,
          fileName: parsed.fileName,
          wordCount: parsed.wordCount,
          truncated: parsed.truncated
        }
      });
    } catch (error) {
      if (error instanceof AppError) {
        if (error.statusCode === 413) {
          return c.json({ success: false, error: 'file_too_large', maxSize: 5242880 }, 413);
        }

        if (error.statusCode === 415) {
          return c.json(
            {
              success: false,
              error: 'unsupported_file_type',
              allowed: [
                'application/pdf',
                'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                'application/vnd.openxmlformats-officedocument.presentationml.presentation'
              ]
            },
            415
          );
        }
      }

      return handleError(c, error, 'Failed to upload document');
    }
  })
  /**
   * POST /agent/research
   *
   * Search the web on a topic and keep the useful pages as material.
   *
   * Returns DRAFT document ids, the same currency `/agent/upload-draft` returns,
   * because the course wizard calls this before the course exists. The caller
   * hands those ids to the first chat turn, which promotes them into real course
   * sources — so a researched page and an uploaded PDF end up in the same Sources
   * panel and the same cached source pack.
   *
   * No paid-plan gate, matching `fetch_documentation_url`: on a self-hosted
   * install the operator supplies and pays for the Jina and model keys directly,
   * so metering here would only block a teacher from material they already
   * bought.
   */
  .post('/research', authMiddleware, orgMemberMiddleware, zValidator('json', ZAgentResearchBody), async (c) => {
    try {
      const user = c.get('user')!;
      const orgId = c.req.header('cio-org-id')!;
      const { topic, depth, courseId } = c.req.valid('json');

      if (!isWebSearchConfigured()) {
        throw new AppError(WEB_SEARCH_UNCONFIGURED, 'WEB_SEARCH_UNCONFIGURED', 503);
      }

      const providerConfig = pickAnyConfiguredProvider();

      if (!providerConfig) {
        throw new AppError('AI provider is not configured', 'AI_PROVIDER_UNCONFIGURED', 503);
      }

      const outcome = await runResearch({
        topic,
        depth,
        orgId,
        courseId,
        userId: user.id,
        redis,
        providerConfig
      });

      return c.json({ success: true as const, data: outcome });
    } catch (error) {
      return handleError(c, error, 'Failed to research the topic');
    }
  })
  .get('/usage/purchased', authMiddleware, orgMemberMiddleware, async (c) => {
    try {
      const orgId = c.req.header('cio-org-id')!;
      const data = await getPurchasedSummary(orgId);

      return c.json({ success: true, data });
    } catch (error) {
      return handleError(c, error, 'Failed to fetch purchased summary');
    }
  })
  .get('/usage/leaderboard', authMiddleware, orgMemberMiddleware, async (c) => {
    try {
      const orgId = c.req.header('cio-org-id')!;
      const data = await getTeamLeaderboard(orgId);

      return c.json({ success: true, data });
    } catch (error) {
      return handleError(c, error, 'Failed to fetch leaderboard');
    }
  })
  .get('/usage', authMiddleware, orgMemberMiddleware, async (c) => {
    try {
      const orgId = c.req.header('cio-org-id')!;
      const usage = await getDetailedUsage(orgId);

      return c.json({ success: true, data: usage });
    } catch (error) {
      return handleError(c, error, 'Failed to fetch usage stats');
    }
  })
  .get(
    '/tutor-usage/leaderboard',
    authMiddleware,
    orgMemberMiddleware,
    zValidator('query', ZTutorUsageQuery),
    async (c) => {
      try {
        const orgId = c.req.header('cio-org-id')!;
        const { period, search, sort, page, limit } = c.req.valid('query');
        const data = await getTutorLearnerLeaderboard(orgId, { period, search, sort, page, limit });

        return c.json({ success: true as const, data });
      } catch (error) {
        return handleError(c, error, 'Failed to fetch learner leaderboard');
      }
    }
  )
  .get(
    '/tutor-usage/summary',
    authMiddleware,
    orgMemberMiddleware,
    zValidator(
      'query',
      ZTutorUsagePeriod.optional()
        .transform((v) => v ?? 'current')
        .pipe(ZTutorUsagePeriod)
        .or(ZTutorUsagePeriod)
        .transform((v) => ({ period: v }))
    ),
    async (c) => {
      try {
        const orgId = c.req.header('cio-org-id')!;
        const period = c.req.query('period');
        const parsed = ZTutorUsagePeriod.safeParse(period);
        const data = await getTutorCapStatusSummary(orgId, parsed.success ? parsed.data : 'current');

        return c.json({ success: true as const, data });
      } catch (error) {
        return handleError(c, error, 'Failed to fetch tutor cap summary');
      }
    }
  )
  .get(
    '/tutor-usage/:userId',
    authMiddleware,
    orgAdminMiddleware,
    zValidator('param', ZTutorUsageUserParam),
    async (c) => {
      try {
        const orgId = c.req.header('cio-org-id')!;
        const { userId } = c.req.valid('param');
        const period = c.req.query('period');
        const parsed = ZTutorUsagePeriod.safeParse(period);
        const data = await getTutorLearnerDetail(orgId, userId, parsed.success ? parsed.data : 'current');

        return c.json({ success: true as const, data });
      } catch (error) {
        return handleError(c, error, 'Failed to fetch learner detail');
      }
    }
  )
  .post('/credits', authMiddleware, orgAdminMiddleware, zValidator('json', ZAgentCreditsBody), async (c) => {
    try {
      const orgId = c.req.header('cio-org-id')!;
      const { amount } = c.req.valid('json');

      await addCredits(orgId, amount);
      const balance = await getTokenBalance(orgId);

      return c.json({ success: true, data: balance });
    } catch (error) {
      return handleError(c, error, 'Failed to purchase credits');
    }
  })
  .post('/credits/purchase', authOrApiKeyMiddleware, zValidator('json', ZAgentCreditPurchase), async (c) => {
    try {
      const body = c.req.valid('json');
      const purchase = await recordCreditPurchase(body);

      return c.json({ success: true, data: purchase });
    } catch (error) {
      return handleError(c, error, 'Failed to record credit purchase');
    }
  })
  .post(
    '/generate-course-title',
    authMiddleware,
    orgMemberMiddleware,
    zValidator('json', ZAgentGenerateCourseTitleBody),
    async (c) => {
      try {
        const { prompt } = c.req.valid('json');

        const providerConfig = pickAnyConfiguredProvider();

        if (!providerConfig) {
          throw new AppError('AI assistant is not configured', 'AI_NOT_CONFIGURED', 503);
        }

        const meta = await generateCourseMeta(prompt, providerConfig);

        return c.json({ success: true as const, data: meta });
      } catch (error) {
        return handleError(c, error, 'Failed to generate course title');
      }
    }
  )
  .post(
    '/generate-text',
    authMiddleware,
    orgMemberMiddleware,
    zValidator('json', ZAgentGenerateTextBody),
    async (c) => {
      try {
        const user = c.get('user')!;
        const orgId = c.req.header('cio-org-id')!;
        const { prompt, tone, format, context, courseId } = c.req.valid('json');

        const providerConfig = pickAnyConfiguredProvider();

        if (!providerConfig) {
          throw new AppError('AI assistant is not configured', 'AI_NOT_CONFIGURED', 503);
        }

        await enforceTokenBalance(orgId);

        const { text, usage, modelName } = await generateFieldText(prompt, tone, format, context, providerConfig);

        if (courseId) {
          await recordTokenUsage(orgId, user.id, courseId, usage, modelName);
        }

        return c.json({ success: true as const, data: { text } });
      } catch (error) {
        return handleError(c, error, 'Failed to generate text');
      }
    }
  )
  .post('/summarize', authMiddleware, orgMemberMiddleware, zValidator('json', ZAgentSummarizeBody), async (c) => {
    try {
      const { messages, courseId } = c.req.valid('json');
      const user = c.get('user')!;

      const isTeamMember = await isCourseTeamMemberOrOrgAdmin(courseId, user.id);

      if (!isTeamMember) {
        throw new AppError(
          'You must be a course team member to summarize conversations',
          'NOT_COURSE_TEAM_MEMBER',
          403
        );
      }

      const summary = await summarizeConversation({ messages });

      return c.json({ success: true as const, data: { summary } });
    } catch (error) {
      return handleError(c, error, 'Failed to summarize conversation');
    }
  })
  .post('/chat', authMiddleware, orgMemberMiddleware, zValidator('json', ZAgentChatBody), async (c) => {
    const user = c.get('user')!;
    const orgId = c.req.header('cio-org-id')!;

    try {
      const { courseId, conversationId, messages, context } = c.req.valid('json');

      const isTeamMember = await isCourseTeamMemberOrOrgAdmin(courseId, user.id);
      const role = isTeamMember ? AgentRole.TEACHER : AgentRole.STUDENT;

      // The model/provider is an operator decision, not a user one: it is chosen
      // entirely by which API key is set in the environment (see
      // pickAnyConfiguredProvider). Any `model` sent by the client is ignored so
      // that switching the platform's AI provider is a single .env change and the
      // client never learns which model is in use.
      const providerConfig = pickAnyConfiguredProvider();

      if (!providerConfig) {
        throw new AppError('AI assistant is not configured', 'AI_NOT_CONFIGURED', 503);
      }

      const [courseRow] = await db
        .select({
          title: schema.course.title,
          description: schema.course.description,
          organizationId: schema.group.organizationId
        })
        .from(schema.course)
        .innerJoin(schema.group, eq(schema.course.groupId, schema.group.id))
        .where(eq(schema.course.id, courseId))
        .limit(1);

      if (!courseRow) {
        throw new AppError('Course not found', 'COURSE_NOT_FOUND', 404);
      }

      if (courseRow.organizationId !== orgId) {
        throw new AppError('Course does not belong to this organization', 'COURSE_ORG_MISMATCH', 403);
      }

      if (conversationId) {
        const conversation = await getChatConversation(conversationId, user.id);

        if (!conversation || conversation.courseId !== courseId) {
          throw new AppError('Conversation not found for this course', 'CONVERSATION_NOT_FOUND', 404);
        }
      }

      const isOrgPaid = role === AgentRole.TEACHER ? await isOrgOnPaidPlan(orgId) : false;

      // Students go through tutor policy (workspace toggle, pool, per-learner cap).
      // Teachers continue to use the existing pool-only check.
      const studentPolicy =
        role === AgentRole.STUDENT ? await enforceStudentTutorPolicy(orgId, courseId, user.id) : null;

      if (role === AgentRole.TEACHER) {
        await enforceTokenBalance(orgId);
      }

      const documentIds = collectDocumentIds(messages, context?.documentId);

      /**
       * Persist wizard drafts BEFORE anything reads the course's sources.
       *
       * A file dropped in the course wizard is uploaded before the course
       * exists, so `/agent/upload-draft` can only put it in Redis. Everything
       * downstream reads Postgres instead: the Sources panel lists
       * `listChatDocumentsByCourse`, and so does `buildSourcePack` — the block
       * that actually carries the material to the model. A Redis-only draft is
       * therefore invisible to BOTH, which is why the panel said "no sources
       * yet" while the agent replied that it could not read the file.
       *
       * The inline fallback (`loadDocumentsContext`) does read Redis, but it
       * only runs when `useSourcePack` is false — never on this path. Hence
       * `docInline=false` on a turn that had a PDF attached.
       *
       * So it has to happen here, ahead of both, and not when messages are
       * saved: by then the turn has already run on empty context. When there is
       * no conversation yet (first turn of a new chat) we create the same hidden
       * "Course sources" one that /agent/upload and /agent/documents/url create,
       * because ai_chat_document.conversation_id is NOT NULL.
       *
       * Best-effort: a source that fails to persist must not kill the turn.
       */
      let sourceConversationId = conversationId;

      if (role === AgentRole.TEACHER && documentIds.length > 0) {
        try {
          if (!sourceConversationId) {
            const created = await createChatConversation(courseId, user.id, 'Course sources');
            sourceConversationId = created.id;
          }

          await promoteDraftDocuments(
            documentIds,
            { userId: user.id, courseId, conversationId: sourceConversationId },
            redis
          );
        } catch (error) {
          console.warn('[agent.documents] draft promotion failed:', error);
        }
      }

      const existingSections = await listCourseSections(courseId);

      // Cache activation: as long as a document is attached and the role is TEACHER
      // (not student tutor) and we're not editing a single lesson, the cache is
      // worth activating. Reasons:
//   1. Building an approved plan (hasApprovedPlan) — dozens of tool calls read
//      the same material. Cache hits compound.
//   2. Planning a course FROM a document on an EMPTY course (genuine
//      build-from-scratch). Cache helps the first chat turn too.
//   3. EDITING an existing course that has a source attached — every edit
//      turn reads the source material again. Without a cache, each turn
//      re-bills the full ~100k-token prompt. With a cache, the material is
//      paid once per 5-min window.
//   4. Single-lesson edits (lessonId present) are NEVER cache-eligible —
//      they're cheap inline reads and the cache doesn't pay back there.
// The policy used to say "only on empty course" to avoid paying for one-off
//      reads. That's obsolete now: the Sources panel pins documents to the
//      course so the instructor WILL re-read them across edits, and the cache
//      handle is keyed per-(org, course, contentHash) so it costs the org
//      nothing to maintain.
      const hasApprovedPlanForCache =
        role === AgentRole.TEACHER ? !!getLatestImplementationPlan(messages) : false;
      const hasDocumentAttached = !!context?.documentId;
      const isSingleLessonEdit =
        role === AgentRole.TEACHER && !!context?.lessonId;
      const cacheEligiblePhase =
        role === AgentRole.TEACHER && hasDocumentAttached && !isSingleLessonEdit;

      // Capa 2b: for a LARGE current document under Gemini, place it in an
      // explicit cache and reference it via providerOptions instead of re-sending
      // its full text every turn (~10% input cost). Fully defensive — an empty
      // result means "inline as before". Gated on cacheEligiblePhase so one-off
      // edits and same-day "attach a file to tweak the course" never spin up a cache.
      const documentCache =
        role === AgentRole.TEACHER && cacheEligiblePhase
          ? await resolveDocumentCache({
              provider: providerConfig.provider,
              currentDocumentId: context?.documentId,
              userId: user.id,
              redis
            })
          : {};

      // The document whose material rides in this turn's cached prefix. Note
      // this is NOT gated on `documentCache` / cacheEligiblePhase: that policy
      // only controls the request-level providerOptions, while the tags that
      // actually make MiniMax cache anything are applied further down from
      // `hasInlineDocumentContext` (context message) and unconditionally on the
      // last message. Gating the badge on the policy meant real cache hits went
      // unrecorded.
      const primaryDocumentId = context?.documentId ?? documentIds[0];

      // RAG for edits (step 6): when a teacher attaches a document to EDIT/extend
      // an ALREADY-BUILT course (existing sections) — i.e. not a fresh build and
      // not cache-eligible — don't inline the whole doc. Instead index it once and
      // expose search_document so the agent pulls only the fragments it needs for
      // the edit. This is the cheap path for one-off edits (no cache storage, no
      // giant inline). Fully defensive: if embeddings are unavailable, indexing is
      // a no-op and we fall back to inlining the text as before.
      let searchableDocumentId: string | null = null;
      const isEditWithDocument =
        role === AgentRole.TEACHER &&
        !!context?.documentId &&
        existingSections.length > 0 &&
        !cacheEligiblePhase;
      if (isEditWithDocument && context?.documentId) {
        try {
          const docText = await getDocumentText(context.documentId, user.id, redis);
          if (docText) {
            if (!(await isDocumentIndexed(context.documentId))) {
              // Index synchronously the first time so search_document works on this
              // very turn; subsequent turns hit the already-indexed fast path.
              await indexDocument({ documentId: context.documentId, courseId, text: docText });
            }
            searchableDocumentId = context.documentId;
          }
        } catch (err) {
          // Never block the chat on indexing — fall back to inline.
          console.error('[agent.chat] edit-RAG indexing failed, falling back to inline:', err);
        }
      }

      // Source pack: for planning and building, the model needs EVERY source at
      // once — you cannot decide a syllabus, or write lesson 9 without repeating
      // lesson 3, from retrieved snippets. It ships as its own stable message so
      // the provider can cache it; see source-pack.ts.
      //
      // Single-lesson edits keep the old per-message loader: they're cheap, scoped,
      // and served better by RAG than by a hundred thousand tokens of context.
      //
      // NOTE (measured, not hypothetical): `isSingleLessonEdit` is just
      // `context.lessonId`, i.e. whether a lesson page happens to be OPEN — not
      // what the teacher asked for. Building a whole course with a lesson tab
      // open therefore runs WITHOUT the pack, and the same request with the tab
      // closed runs with it. Across one real session the pack was present on 1
      // turn out of 9, and every switch between the two shapes is a prompt-cache
      // miss on ~71k tokens (that is the "cache anomaly": a 16% hit right after
      // the pack reappeared, not a caching fault).
      //
      // Left as-is deliberately: flipping it costs ~71k tokens on every lesson
      // turn, so it is a cost decision, not a bug fix.
      const useSourcePack = role === AgentRole.TEACHER && !isSingleLessonEdit && !searchableDocumentId;

      const sourcePack = useSourcePack
        ? await buildSourcePack({
            courseId,
            userId: user.id,
            redis,
            excludeFullTextForId: documentCache.excludeDocumentId ?? undefined
          })
        : undefined;

      const documentText =
        !useSourcePack && documentIds.length > 0
          ? await loadDocumentsContext(
              documentIds,
              context?.documentId,
              user.id,
              // Exclude the doc's full text when it's cached OR searchable-via-RAG.
              documentCache.excludeDocumentId ?? searchableDocumentId ?? undefined
            )
          : undefined;

      let lessonTitle: string | undefined;
      let lessonContent: string | undefined;
      if (context?.lessonId) {
        try {
          await verifyLessonBelongsToCourse(context.lessonId, courseId);
          const lesson = await getLesson(context.lessonId);
          lessonTitle = lesson.title;
          const lessonWithLangs = lesson as {
            lessonLanguages?: Array<{ locale: string; content: string | null }>;
          };
          const editorLocale = context?.locale ?? 'en';
          const langContent =
            lessonWithLangs.lessonLanguages?.find((ll) => ll.locale === editorLocale) ??
            lessonWithLangs.lessonLanguages?.find((ll) => ll.locale === 'en');
          lessonContent = langContent?.content || undefined;
        } catch {
          // Lesson not found or doesn't belong — continue without lesson context
        }
      }

      let exerciseTitle: string | undefined;
      if (context?.exerciseId) {
        try {
          await verifyExerciseBelongsToCourse(context.exerciseId, courseId);
          const exercise = await getExercise(context.exerciseId);
          exerciseTitle = exercise.title;
        } catch {
          // Exercise not found or doesn't belong — continue without exercise context
        }
      }

      const agentContext: AgentContext = {
        orgId,
        courseId,
        courseTitle: courseRow.title,
        courseDescription: courseRow.description || undefined,
        userId: user.id,
        role,
        locale: context?.locale ?? 'en',
        lessonId: context?.lessonId,
        lessonTitle,
        lessonContent,
        exerciseId: context?.exerciseId,
        exerciseTitle,
        documentId: context?.documentId,
        documentText,
        searchableDocument: !!searchableDocumentId,
        courseSourceCount: sourcePack?.entries.length,
        truncatedSourceCount: sourcePack?.truncatedCount,
        existingSectionCount: existingSections.length
      };

      trackAgentEvent(AgentEvent.CHAT_STARTED, {
        orgId,
        userId: user.id,
        courseId,
        role,
        hasDocument: !!documentText,
        messageCount: messages.length
      });

      const startTime = Date.now();
      const model = createModel(providerConfig);
      const approvedPlan = role === AgentRole.TEACHER ? getLatestImplementationPlan(messages) : undefined;
      const activeTemplateId = role === AgentRole.TEACHER ? getActiveCourseTemplateId(messages) : undefined;
      const activeTemplate = activeTemplateId ? getCourseTemplate(activeTemplateId) : undefined;

      // Paso 3 (prompt por fase): scope the system prompt to the conversation's
      // phase instead of always sending the 12.6k-token monolith.
      // - build: a plan was approved → implementation/content rules (~9.3k tokens).
      // - plan: no plan AND nothing to edit yet → pure planning conversation
      //   (wizard/discovery) → planning rules only (~6.6k tokens).
      // - full: there is already something to edit — a lesson is open, or the
      //   course has sections — so the content-writing rules are required.
      //
      // See resolveTeacherPromptMode for why `existingSections` participates:
      // deriving the phase from the transcript alone made every fresh chat on an
      // already-built course read-only.
      //
      // Each mode yields a stable, cacheable prefix; the one cache miss happens
      // at the plan→build transition, then the build prefix caches for the run.
      const teacherPromptMode: TeacherPromptMode = resolveTeacherPromptMode({
        isTeacher: role === AgentRole.TEACHER,
        hasApprovedPlan: !!approvedPlan,
        lessonId: context?.lessonId,
        existingSectionCount: existingSections.length
      });

      // Stable across requests — safe to cache as a long-lived Anthropic prefix.
      // Volatile per-request context (lesson/exercise/document/section count/
      // approved plan/active template) is sent as a user-turn message instead so
      // it doesn't invalidate the tools+system cache.
      const systemPrompt = buildSystemPrompt(agentContext, {
        tutorSettings: studentPolicy?.settings,
        isOrgOnPaidPlan: isOrgPaid,
        mode: teacherPromptMode
      });

      let contextMessageText = buildContextMessage(agentContext, {
        template: activeTemplate,
        approvedPlan
      });

      // The Anthropic-compatible document cache is "inline" — the document text
      // MUST live inside a request content block (so the cache_control hint can
      // mark THAT block as cached). When `documentText` is present, the build
      // of `contextMessageText` embeds the full PDF text inside <document> tags,
      // so the prepended context user message is the one we want to tag.
      // (For Gemini the cache lives in a separate server-side resource and the
      //  text is intentionally omitted from the inline context — see
      //  `excludeDocumentId` in resolveDocumentCache — so we must NOT tag a
      //  context block that doesn't contain the PDF, or MiniMax would cache a
      //  block with no document inside.)
      const hasInlineDocumentContext =
        role === AgentRole.TEACHER &&
        !!documentText &&
        documentText.length > 0 &&
        providerConfig.provider !== AIProvider.GOOGLE;

      // Same idea for the source pack, which is the far bigger block and lives in
      // its own message (see below).
      const hasSourcePackContext =
        role === AgentRole.TEACHER &&
        !!sourcePack?.text &&
        providerConfig.provider !== AIProvider.GOOGLE;

      // Server-measured build progress, reused three ways: as the coherence anchor
      // in the prompt, as the checklist the UI renders, and as the signal that
      // decides whether the round should continue on its own.
      let planProgress: PlanProgress | undefined;

      // Coherence anchor: when a plan is being implemented, inject the REAL course
      // state (plan vs live structure — done/empty/missing per item) so the agent
      // can't lose track of progress when history is trimmed or falsely believe it
      // finished. Only when there's an approved plan (skip the extra query otherwise).
      if (approvedPlan) {
        try {
          // Reconcile the plan into the registry FIRST: it assigns each item a
          // stable key and preserves the binding of everything already built, so
          // a re-planned or teacher-edited plan doesn't orphan existing rows.
          const registry = await syncPlanRegistry({
            orgId,
            courseId,
            conversationId,
            userId: user.id,
            plan: approvedPlan
          }).catch((err: unknown) => {
            console.error('[agent.chat] failed to sync plan registry:', err);
            return [];
          });

          const [progressItems, progressSections] = await Promise.all([
            getCourseContentItems(courseId),
            listCourseSections(courseId)
          ]);
          const progress = buildPlanProgressAnchor(approvedPlan, progressSections, progressItems, registry);
          if (progress) {
            planProgress = progress;
            contextMessageText = contextMessageText
              ? `${contextMessageText}\n\n${progress.anchorText}`
              : progress.anchorText;
          }
        } catch (err) {
          // Never block the chat on the anchor — it's an enhancement, not required.
          console.error('[agent.chat] failed to build plan progress anchor:', err);
        }
      }

      // Material-cap notice (policy: 400k cached tokens per course). Tell the model
      // so it warns the instructor, in the conversation's language, that no more
      // source material fits this course and a separate course is the way forward.
      if (documentCache.overLimit) {
        const capNotice =
          '[Material limit] The attached document exceeds the 400k-token material limit for one course. ' +
          'Only the first part of it is available to you. Tell the instructor (in their language) that the ' +
          'course material is full: no more source material fits this course, and suggest splitting the ' +
          'remaining content into a separate new course.';
        contextMessageText = contextMessageText ? `${contextMessageText}\n\n${capNotice}` : capNotice;
      }

      const agentTools =
        role === AgentRole.STUDENT
          ? buildStudentAgentTools(
              orgId,
              user.id,
              courseId,
              studentPolicy!.settings,
              agentContext.locale as TLocale
            )
          : buildAgentTools(orgId, user.id, courseId, messages, {
              isOrgOnPaidPlan: isOrgPaid,
              conversationId,
              searchableDocumentId
            });

      const contextManaged = await buildModelContextMessages({
        conversationId,
        courseId,
        userId: user.id,
        messages
      });
      // Paso 1 (context diet): after converting the persisted history, strip tool
      // call/result content (including the huge INPUTS — full lesson HTML in
      // update_lesson_content, 150KB fetch outputs...) from all but the last 2
      // messages. Ground truth doesn't live in old tool calls: the server rebuilds
      // it every turn via the plan-progress + TODO anchors, and the model can
      // re-read anything cheaply (get_course_structure/get_lesson_content).
      // Without this, one build round (40 steps folded into ONE assistant
      // message) kept 300K-1M chars of tool inputs inside the keep-window.
      const convertedMessages = pruneMessages({
        messages: sanitizeDanglingToolCalls(await convertToModelMessages(contextManaged.messages as any)),
        toolCalls: 'before-last-2-messages',
        emptyMessages: 'remove'
      });
      let completedStepCount = 0;
      let lastStepInputTokens: number | undefined;
      let finishReason: string | undefined;
      // Set in onFinish (async) so the sync messageMetadata callback can report to the
      // UI whether the plan is still incomplete — this drives the "Continue" button
      // even when the model wrongly claimed the course was finished.
      let planIncomplete: { pendingCount: number; emptyCount: number } | undefined;

      const isAnthropic = providerConfig.provider === AIProvider.ANTHROPIC;
      const isAnthropicCompatible = isAnthropic || providerConfig.provider === AIProvider.MINIMAX;

      // 1h TTL keeps the prefix warm across tool-execution gaps in long agent
      // runs. Break-even is 3 requests within the hour; well under most plan-
      // execution loops. Applies to BOTH Anthropic and MiniMax — they share the
      // same SDK and wire format, so cache_control is honored on both.
      const systemContent = isAnthropicCompatible
        ? {
            role: 'system' as const,
            content: systemPrompt,
            providerOptions: {
              anthropic: { cacheControl: { type: 'ephemeral', ttl: '1h' } }
            }
          }
        : systemPrompt;

      // Paso 5a (build subagent — clean context): in build mode the agent is
      // executing an approved plan, not continuing a conversation. The full
      // discovery/chat transcript is dead weight and can distract the builder,
      // so we run it with an ISOLATED context: just the context message (which
      // already carries the approved plan + Plan-Progress + TODO anchors — the
      // real source of truth) plus the single latest user turn (the "Implement
      // this plan." / "continue" instruction). This keeps the builder focused
      // and stops the build from ever polluting or being polluted by the main
      // conversation history. Same streamText/response, so the UI is unchanged.
      //
      // Every other mode (plan, single-lesson edit, student) keeps the full
      // trimmed transcript, since those ARE conversational.
      const isBuildSubagent = role === AgentRole.TEACHER && teacherPromptMode === 'build';
      const builderMessages = isBuildSubagent
        ? (() => {
            const lastUserIndex = convertedMessages.map((m) => m.role).lastIndexOf('user');
            return lastUserIndex >= 0 ? [convertedMessages[lastUserIndex]] : [];
          })()
        : convertedMessages;

      // Two prepended messages, in this order, and the order is the whole point:
      //
      //   A. The source pack — large and byte-identical for the life of the
      //      course. Tagged with cache_control, so everything up to and including
      //      it is served from cache on later turns.
      //   B. Volatile context — course structure, plan progress, current lesson.
      //      Changes every single turn, and is deliberately NOT tagged.
      //
      // These used to be one message carrying both, tagged as a unit. A prompt
      // cache is a prefix match, so each new section the agent created changed the
      // block and invalidated the sources with it: the pack was re-written at
      // 1.25x on every build turn instead of being read back at 0.1x — the exact
      // opposite of what the cache is for.
      const sourcePackMessage = sourcePack?.text
        ? ({
            role: 'user' as const,
            content: [{ type: 'text' as const, text: sourcePack.text }],
            ...(isAnthropicCompatible && hasSourcePackContext
              ? {
                  providerOptions: {
                    anthropic: { cacheControl: { type: 'ephemeral', ttl: '1h' } }
                  }
                }
              : {})
          })
        : null;

      const contextMessage =
        contextMessageText.length > 0
          ? ({
              role: 'user' as const,
              content: [{ type: 'text' as const, text: contextMessageText }],
              // Only tagged on the legacy inline-document path (single-lesson
              // edits), where the material really does live in THIS block. When
              // the source pack is in play the tag belongs on message A above;
              // tagging here too would just pin a boundary that moves every turn.
              ...(isAnthropicCompatible && hasInlineDocumentContext && !sourcePackMessage
                ? {
                    providerOptions: {
                      anthropic: { cacheControl: { type: 'ephemeral', ttl: '1h' } }
                    }
                  }
                : {})
            })
          : null;

      const modelMessages = [
        ...(sourcePackMessage ? [sourcePackMessage] : []),
        ...(contextMessage ? [contextMessage] : []),
        ...builderMessages
      ];

      if (sourcePack?.text) {
        console.log(
          `[agent.chat] source pack: ${sourcePack.entries.length} source(s), ` +
            `~${sourcePack.estimatedTokens} tokens, ${sourcePack.truncatedCount} summarized`
        );
      }

      if (isBuildSubagent) {
        console.log(
          `[agent.chat] build subagent: isolated context (${builderMessages.length} user turn(s), ${convertedMessages.length} transcript msgs dropped)`
        );
      }

      console.log(`[agent.chat] user=${user.id} messages=${modelMessages.length}`);

      // Cache the growing conversation prefix: each turn reads the prior
      // transcript at ~0.1x cost instead of reprocessing it at full price.
      if (isAnthropicCompatible && modelMessages.length > 0) {
        const lastMessage = modelMessages[modelMessages.length - 1];
        const existingAnthropic = (lastMessage.providerOptions?.anthropic as Record<string, unknown> | undefined) ?? {};
        lastMessage.providerOptions = {
          ...(lastMessage.providerOptions ?? {}),
          anthropic: {
            ...existingAnthropic,
            cacheControl: { type: 'ephemeral', ttl: '1h' }
          }
        };
      }

      // Paso 3 (tools por fase): restrict which tools ship to the provider per
      // mode. Filtered tools are omitted from the request entirely (real token
      // savings on every call) while the full ToolSet stays registered, so tool
      // definitions never change shape. Rationale per mode:
      // - plan: no write tools (the prompt forbids building pre-approval anyway;
      //   this enforces it) — reads, planning tools, docs fetch, landing page
      //   (templates set it during the plan phase) and go-live check remain.
      //   Only reachable for a course with NO sections yet, so "no write tools"
      //   can never strand a teacher on a course that already has content.
      // - build: everything except the two questionnaire tools (discovery and
      //   template forms only run pre-plan) and update_course_todo_list.
      //   generate_course_plan STAYS — the shared "re-show the plan" rule and
      //   mid-build revisions need it.
      //
      //   The todo list is dropped because it cost more than it bought. The prompt
      //   asked for one bookkeeping call per built item; with MAX_STEPS_PER_ROUND
      //   at 40 that is a third of the round spent narrating instead of building,
      //   so the model rationally skipped it — which is how a checklist could read
      //   1/32 with ten lessons already written. Progress is now measured by the
      //   server (buildPlanProgressAnchor over the plan registry), so the model
      //   does not have to spend steps reporting on itself.
      // - full (lesson-edit chat, chat on an existing course, students): no
      //   restriction.
      const activeToolNames =
        role === AgentRole.TEACHER && teacherPromptMode === 'plan'
          ? ([
              'get_course_structure',
              'get_lesson_content',
              'get_exercise_details',
              'generate_course_plan',
              'ask_template_questions',
              'ask_discovery_questions',
              'fetch_documentation_url',
              // Planning is exactly when missing material hurts: without search
              // here, the agent can only read URLs it was handed.
              'search_web',
              'update_course_landing_page',
              'check_course_go_live_readiness'
            ] as const)
          : role === AgentRole.TEACHER && teacherPromptMode === 'build'
            ? (Object.keys(agentTools).filter(
                (name) =>
                  name !== 'ask_template_questions' &&
                  name !== 'ask_discovery_questions' &&
                  name !== 'update_course_todo_list'
              ) as Array<keyof typeof agentTools & string>)
            : undefined;

      // Capa 2b: reference the document's explicit cache (if one was created)
      // so its ~large text is billed at ~10% instead of re-sent inline.
      // Provider-agnostic: `documentCache.providerOptions` carries the
      // provider-specific shape (google.cachedContent for Gemini, anthropic
      // .cacheControl for MiniMax/Claude).
      const cacheProviderOptions = documentCache.providerOptions as
        | Parameters<typeof streamText>[0]['providerOptions']
        | undefined;
      if (documentCache.excludeDocumentId) {
        console.log(`[agent.chat] using document cache for document (${documentCache.excludeDocumentId})`);
      }

      // Extended thinking — REAL Anthropic only, not every Anthropic-compatible
      // endpoint.
      //
      // This was gated on `isAnthropicCompatible` because MiniMax's capability
      // table lists `thinking`. In practice it does not come back: every single
      // MiniMax turn in production and in local dev reports `reasoning=0` while
      // the budget is enabled. The chain-of-thought is returned as ORDINARY TEXT
      // instead, and that costs three things at once —
      //   1. the learner-facing chat shows the raw reasoning, because to the
      //      client it is simply the message body;
      //   2. it is billed against the output allowance, so the effective cap
      //      becomes maxOutputTokens + budgetTokens;
      //   3. with no thinking block to spend it in, the model narrates instead
      //      of calling a tool.
      // A teacher hit all three: creating a course with a 165-page PDF attached,
      // one turn ran 5m30s, emitted the full 20,480-token ceiling, finished on
      // `length`, called NO tools and built nothing. Short plan turns survived it,
      // which is why it took a large source pack to surface.
      //
      // cache_control is unaffected and stays on both providers — MiniMax honours
      // that one (observed hit rates of 50–99%).
      //
      // Enabled per phase because the two phases want opposite things:
      //  - plan: pure judgement — how many sections, what depth, what the sources
      //    actually support. Worth a generous budget; it runs a handful of steps.
      //  - build: mostly mechanical execution of a plan already agreed. It runs up
      //    to 40 steps, and every thinking block bills as output, so the budget is
      //    deliberately small.
      // Both are env-tunable, and setting a budget to 0 turns thinking off for
      // that phase without a deploy.
      const thinkingBudget =
        isAnthropic && role === AgentRole.TEACHER
          ? teacherPromptMode === 'plan'
            ? resolveThinkingBudget('AGENT_THINKING_BUDGET_PLAN', 4096)
            : teacherPromptMode === 'build'
              ? resolveThinkingBudget('AGENT_THINKING_BUDGET_BUILD', 2048)
              : 0
          : 0;

      const providerOptions: Parameters<typeof streamText>[0]['providerOptions'] =
        thinkingBudget > 0
          ? {
              ...(cacheProviderOptions ?? {}),
              anthropic: {
                ...((cacheProviderOptions?.anthropic as Record<string, unknown>) ?? {}),
                thinking: { type: 'enabled', budgetTokens: thinkingBudget }
              }
            }
          : cacheProviderOptions;

      if (thinkingBudget > 0) {
        console.log(`[agent.chat] extended thinking enabled phase=${teacherPromptMode} budget=${thinkingBudget}`);
      }

      const result = streamText({
        model,
        maxRetries: 2,
        /**
         * Rewrite a tool call whose arguments failed schema validation.
         *
         * Without this an InvalidToolInputError aborts the entire round: the
         * teacher watched a build die because `create_exercise` arrived missing
         * `sectionId` and `title`, having already written several lessons in the
         * same round. Nothing was wrong with the work — only with one JSON body.
         *
         * The failure happens while PARSING the model's arguments, before any
         * tool runs, so the returned-failure path in `executeAgentTool` cannot
         * catch it and the UI never marks a step failed (there is no step yet).
         * Repair is the only place to intervene.
         *
         * One attempt, with the schema and the rejected JSON in hand. Returning
         * null on any problem falls back to the previous behaviour rather than
         * risking a repair loop.
         */
        repairToolCall: async ({ toolCall, inputSchema, error }) => {
          // A hallucinated tool NAME is not repairable — there is no schema to
          // repair against, and inventing one would just move the failure.
          if (NoSuchToolError.isInstance(error)) return null;

          try {
            const schema = await inputSchema({ toolName: toolCall.toolName });
            const { text } = await generateText({
              model,
              maxOutputTokens: 4096,
              system:
                'You repair malformed tool arguments. Reply with the corrected JSON object ONLY — ' +
                'no prose, no markdown fence. Preserve every value the original already had; ' +
                'your job is to satisfy the schema, not to rewrite the content.',
              prompt:
                `Tool: ${toolCall.toolName}\n\n` +
                `JSON Schema:\n${JSON.stringify(schema)}\n\n` +
                `Rejected arguments:\n${toolCall.input}\n\n` +
                `Validation error:\n${error.message}`
            });

            // Models fence JSON even when told not to; strip it before parsing
            // so a cosmetic wrapper doesn't waste the one repair attempt.
            const cleaned = text
              .trim()
              .replace(/^```(?:json)?\s*/i, '')
              .replace(/\s*```$/, '');

            JSON.parse(cleaned); // Throw here rather than hand the SDK bad JSON.

            console.log(`[agent.chat] repaired tool input for "${toolCall.toolName}"`);

            return { ...toolCall, input: cleaned };
          } catch (repairError) {
            console.error(
              `[agent.chat] tool input repair failed for "${toolCall.toolName}":`,
              repairError instanceof Error ? repairError.message : repairError
            );
            return null;
          }
        },
        // MiniMax-M3 isn't in the Anthropic SDK model registry, so without an
        // explicit value the SDK defaults to 4096 output tokens and emits a
        // "compatibility mode" warning — course generation routinely needs
        // 10–20k output tokens (full lesson HTML for many sections), so we
        // pin a generous cap. Anthropic Sonnet 4 maxes at 8192, but MiniMax
        // MiniMax-M3 has a much higher ceiling, so 16384 is a safe upper bound
        // for course-building turns. Other providers (Gemini Flash-Lite,
        // OpenAI) just clamp this to their own max without harm.
        maxOutputTokens: 16384,
        system: systemContent,
        messages: modelMessages,
        tools: agentTools,
        ...(activeToolNames ? { activeTools: activeToolNames as any } : {}),
        ...(providerOptions ? { providerOptions } : {}),
        stopWhen: stepCountIs(MAX_STEPS_PER_ROUND),
        // Paso 2 (context diet, intra-round): a build round runs up to 40 steps in
        // one loop, and by default every step re-sends ALL prior steps' tool calls
        // verbatim — including full lesson-HTML inputs and 150KB fetched docs. From
        // step 5 on, prune tool content older than the last 4 messages; the recent
        // pair the model is actively working with stays intact, and the override
        // carries forward so the window stays flat instead of growing quadratically.
        prepareStep: ({ stepNumber, messages: stepMessages }) => {
          if (stepNumber < 5) return {};
          return {
            messages: pruneMessages({
              messages: stepMessages,
              toolCalls: 'before-last-4-messages',
              // With thinking on, every step adds a reasoning block that
              // `pruneMessages` keeps by default (`reasoning: 'none'`), so a
              // 40-step build would carry ~40 of them by the end and undo the
              // context diet this pruning exists for. Keeping only the latest is
              // also what Anthropic's tool-use protocol requires: the thinking
              // that precedes the tool_use being continued must survive.
              ...(thinkingBudget > 0 ? { reasoning: 'before-last-message' as const } : {}),
              emptyMessages: 'remove'
            })
          };
        },
        onStepFinish: (step) => {
          completedStepCount += 1;
          // Size of the LAST request actually sent to the provider. This — not
          // `totalUsage` — is what "how full is the context window" means.
          // `totalUsage` aggregates every step of the round, so a 2-step turn
          // over a 110k-token document reports ~220k and makes a brand-new
          // conversation look 100% full against the 200k budget.
          lastStepInputTokens = step.usage?.inputTokens ?? lastStepInputTokens;
        },
        onFinish: async ({ totalUsage, finishReason: resultFinishReason, steps }) => {
          completedStepCount = steps.length;
          finishReason = resultFinishReason;
          const durationMs = Date.now() - startTime;

          // What the model actually DID this round. Without this, a turn where
          // it narrates an action ("voy a generar el plan") and then stops
          // without calling the tool is indistinguishable from a turn that
          // worked — both just end. `phase` and `toolsOffered` are here because
          // the first question is always "was the tool even available?".
          const toolCalls = steps.flatMap((step) =>
            step.toolCalls.map((call) => call.toolName)
          );
          console.log(
            `[agent.chat] phase=${teacherPromptMode} finish=${resultFinishReason} steps=${steps.length} ` +
              `toolsOffered=${activeToolNames?.length ?? 'all'} toolCalls=[${toolCalls.join(', ') || 'NONE'}] ` +
              `docInline=${hasInlineDocumentContext}`
          );

          // Re-check the plan vs the (now-updated) live course. If items are still
          // missing/empty, flag it so the UI can offer "Continue" — regardless of
          // whether the model stopped by choice or hit the step limit.
          if (approvedPlan) {
            try {
              const [finalItems, finalSections, finalRegistry] = await Promise.all([
                getCourseContentItems(courseId),
                listCourseSections(courseId),
                readPlanRegistry({ orgId, courseId, conversationId, userId: user.id }).catch(() => [])
              ]);
              const finalProgress = buildPlanProgressAnchor(
                approvedPlan,
                finalSections,
                finalItems,
                finalRegistry
              );
              if (finalProgress) {
                // The checklist the UI renders comes from HERE — reconciled after the
                // round's writes landed, so it reports what exists rather than what
                // the model said it did.
                planProgress = finalProgress;

                if (finalProgress.pendingCount > 0 || finalProgress.emptyCount > 0) {
                  planIncomplete = {
                    pendingCount: finalProgress.pendingCount,
                    emptyCount: finalProgress.emptyCount
                  };
                }
              }
            } catch (err) {
              console.error('[agent.chat] failed to recompute plan progress at finish:', err);
            }
          }
          const inputTokens = totalUsage?.inputTokens ?? 0;
          const outputTokens = totalUsage?.outputTokens ?? 0;
          // Trust the provider's own total — do NOT recompute as input+output,
          // which can diverge from what the API actually billed.
          const reportedTotal = totalUsage?.totalTokens ?? inputTokens + outputTokens;

          // Detailed breakdown (provider-agnostic in AI SDK v7): reasoning is a
          // subset of output; cacheRead/cacheWrite are subsets of input. Populated
          // for Anthropic AND Gemini — recorded per row for cost analytics and to
          // measure the explicit-cache savings (Capa 2b).
          const inputDetails = totalUsage?.inputTokenDetails;
          const outputDetails = totalUsage?.outputTokenDetails;
          const cacheRead = inputDetails?.cacheReadTokens ?? 0;
          const cacheWrite = inputDetails?.cacheWriteTokens ?? 0;
          const reasoning = outputDetails?.reasoningTokens ?? 0;

          // Cache hit/miss visibility (all providers). If cacheRead stays 0 across
          // repeated turns of the same conversation, a silent invalidator is leaking
          // into the cached prefix — audit system prompt and tool definitions.
          const uncached = inputDetails?.noCacheTokens ?? inputTokens;
          const totalIn = uncached + cacheRead + cacheWrite;
          const hitRate = totalIn > 0 ? Math.round((cacheRead / totalIn) * 100) : 0;
          console.log(
            `[agent.chat] cache hit=${hitRate}% read=${cacheRead} write=${cacheWrite} uncached=${uncached} output=${outputTokens} reasoning=${reasoning}`
          );

          // The ONLY evidence that the provider is really caching this
          // material. The Anthropic-compatible API has no cache-status
          // endpoint, so the Sources panel badge is driven from here: a handle
          // is written only when cacheRead > 0. Guarded on the provider because
          // the Gemini backend owns the same Redis key with a real, explicitly
          // created cachedContent handle that must not be overwritten.
          //
          // Precision caveat, deliberately accepted: `cacheRead` covers the
          // whole cached prefix (system prompt + context message with the
          // document inside), so it attests "the provider served cached input
          // on a turn carrying this document", not "these exact bytes came
          // from cache". The API exposes no per-block breakdown. That is still
          // evidence of a real provider-side cache, which is what the badge
          // previously lacked entirely.
          if (isAnthropicCompatible && (hasInlineDocumentContext || hasSourcePackContext) && cacheRead > 0) {
            // EVERY source in the pack rides in the same cached block, so a
            // confirmed read is evidence for all of them — not just the one
            // attached to this message. Attributing the hit only to
            // `primaryDocumentId` left the other sources showing "not cached"
            // while they were provably being served from cache.
            const hitDocumentIds = sourcePack?.entries.length
              ? sourcePack.entries.map((entry) => entry.id)
              : primaryDocumentId
                ? [primaryDocumentId]
                : [];

            // Resolved here rather than before the stream: a handful of DB reads
            // per turn, running after the response is already out, so it costs
            // the user nothing. Only reached on a confirmed hit.
            await Promise.all(
              hitDocumentIds.map(async (documentId) => {
                const keyInfo = await getChatDocumentCacheKey(documentId).catch(() => null);
                return recordAnthropicCacheHit({
                  documentId,
                  courseId: keyInfo?.courseId,
                  contentHash: keyInfo?.contentHash ?? undefined,
                  cacheReadTokens: cacheRead,
                  redis
                });
              })
            ).catch((err) => console.error('[agent.chat] recordAnthropicCacheHit failed:', err));
          }

          if (totalUsage) {
            await recordTokenUsage(
              orgId,
              user.id,
              courseId,
              {
                promptTokens: inputTokens,
                completionTokens: outputTokens,
                totalTokens: reportedTotal,
                reasoningTokens: reasoning || undefined,
                cacheReadTokens: cacheRead || undefined,
                cacheWriteTokens: cacheWrite || undefined
              },
              providerConfig.model || providerConfig.provider
            );
          }

          if (role === AgentRole.STUDENT) {
            await incrementStudentTutorCount(orgId, user.id, courseId);
          }

          trackAgentEvent(AgentEvent.CHAT_COMPLETED, {
            orgId,
            userId: user.id,
            courseId,
            inputTokens,
            outputTokens,
            model: providerConfig.model || providerConfig.provider,
            durationMs
          });
        }
      });

      return result.toUIMessageStreamResponse({
        // Without this, the AI SDK's default handler (`() => 'An error occurred.'`)
        // replaces every in-stream failure with that string and logs NOTHING —
        // the actual cause is discarded, so a broken tool call is invisible in
        // both the browser console and the API log. Log it in full here; it is
        // the only place the real error still exists.
        onError: (error) => {
          // InvalidToolInputError carries the RAW JSON the model emitted plus the
          // validation cause. Without printing both, "invalid input for tool X"
          // says nothing about WHICH property the model got wrong — and the model
          // will keep making the same mistake every retry.
          if (InvalidToolInputError.isInstance(error)) {
            console.error(
              `[agent.chat] invalid tool input for "${error.toolName}"\n` +
                `  cause: ${error.cause instanceof Error ? error.cause.message : JSON.stringify(error.cause)}\n` +
                `  raw input: ${error.toolInput}`
            );

            // The validation detail is multi-line ("Type validation failed:\n
            // Value: …\nError: …") and the chat bubble shows only the first
            // line, which is the useless one. Collapse to a single line so the
            // actual failing path survives into the UI.
            const cause = (error.cause instanceof Error ? error.cause.message : String(error.cause ?? ''))
              .replace(/\s+/g, ' ')
              .slice(0, 600);

            return `Error del agente: entrada inválida para "${error.toolName}". ${cause}`;
          }

          console.error('[agent.chat] stream error:', error);

          const message = error instanceof Error ? error.message : String(error);

          // Self-hosted instructor tooling: surfacing the real message makes the
          // failure actionable instead of a dead end. Keep it to the message —
          // never the stack.
          return `Error del agente: ${message}`;
        },
        messageMetadata: ({ part }) => {
          if (part.type !== 'finish') {
            return undefined;
          }

          return {
            tokenUsage: {
              // Reported verbatim by the provider (AI SDK v7) — never recomputed.
              promptTokens: part.totalUsage.inputTokens,
              completionTokens: part.totalUsage.outputTokens,
              totalTokens: part.totalUsage.totalTokens,
              reasoningTokens: part.totalUsage.outputTokenDetails?.reasoningTokens,
              cacheReadTokens: part.totalUsage.inputTokenDetails?.cacheReadTokens,
              cacheWriteTokens: part.totalUsage.inputTokenDetails?.cacheWriteTokens,
              // How full the context window actually is, for the UI gauge.
              // Distinct from promptTokens/totalTokens, which are BILLING
              // figures summed over every step of the round.
              contextTokens: lastStepInputTokens,
              // What that occupancy is MADE OF, so the teacher (and the compact
              // affordance) can tell reclaimable transcript from the fixed cost
              // of the sources, which compaction cannot touch.
              contextBreakdown: measureContextBreakdown({
                totalContextTokens: lastStepInputTokens ?? 0,
                systemPrompt,
                sourcePackTokens: sourcePack?.estimatedTokens,
                turnContextText: contextMessageText,
                conversationMessages: builderMessages
              })
            },
            // Server-measured build progress: the plan reconciled against the live
            // course. Replaces the checklist that used to be drawn from the model's
            // own update_course_todo_list output, which drifted from reality because
            // nothing forced the model to keep it current.
            planProgress: planProgress
              ? {
                  total: planProgress.total,
                  completed: planProgress.completed,
                  pendingCount: planProgress.pendingCount,
                  emptyCount: planProgress.emptyCount,
                  items: planProgress.items
                }
              : undefined,
            continuation:
              completedStepCount >= MAX_STEPS_PER_ROUND
                ? {
                    reason: 'step_limit' as const,
                    maxSteps: MAX_STEPS_PER_ROUND,
                    finishReason
                  }
                : planIncomplete
                  ? {
                      // The model stopped (often falsely claiming completion) but the
                      // plan still has missing/empty items — offer the teacher a Continue.
                      reason: 'incomplete_plan' as const,
                      pendingCount: planIncomplete.pendingCount,
                      emptyCount: planIncomplete.emptyCount,
                      finishReason
                    }
                  : finishReason === 'length'
                    ? {
                        // The model ran out of output budget mid-sentence. Nothing
                        // above catches this: it can happen on step 1 with no tool
                        // calls, so neither the step cap nor the plan check fires,
                        // and the teacher was left staring at a truncated wall of
                        // text with no indication that anything had gone wrong. One
                        // real turn ran 5m30s, built nothing, and said nothing.
                        reason: 'output_limit' as const,
                        finishReason
                      }
                    : undefined
          };
        }
      });
    } catch (error) {
      trackAgentEvent(AgentEvent.CHAT_ERROR, {
        orgId,
        userId: user?.id,
        errorMessage: error instanceof Error ? error.message : 'Unknown error'
      });

      if (error instanceof AppError) {
        return c.json({ success: false, error: error.message, code: error.code }, error.statusCode);
      }

      console.error('Agent chat error:', error);
      return c.json({ success: false, error: 'Failed to process chat message', code: 'INTERNAL_ERROR' }, 500);
    }
  });

export const agentRouter = new Hono()
  .use('*', agentContentTypeRewrite)
  .route('/', agentCoreRouter)
  .route('/history', agentHistoryRouter)
  .route('/runs', agentRunsRouter)
  .route('/documents', agentDocumentsRouter)
  .route('/lessons', agentDiagramsRouter);
