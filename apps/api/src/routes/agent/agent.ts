import { Hono } from '@api/utils/hono';
import { authMiddleware } from '@api/middlewares/auth';
import { orgMemberMiddleware } from '@api/middlewares/org-member';
import { orgAdminMiddleware } from '@api/middlewares/org-admin';
import { authOrApiKeyMiddleware } from '@api/middlewares/auth-or-api-key';
import { agentContentTypeRewrite } from '@api/middlewares/agent-content-type';
import { handleError, AppError } from '@api/utils/errors';
import { zValidator } from '@hono/zod-validator';
import { streamText, stepCountIs, convertToModelMessages, pruneMessages } from 'ai';
import {
  ZAgentChatBody,
  ZAgentCreditPurchase,
  ZAgentCreditsBody,
  ZAgentGenerateCourseTitleBody,
  ZAgentGenerateTextBody,
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
  getDocumentText
} from '@api/services/agent/document';
import { createChatConversation } from '@api/services/agent/chat-history';
import { resolveDocumentCache } from '@api/services/agent/document-cache';
import { indexDocument, isDocumentIndexed } from '@api/services/agent/embeddings';
import { recordCreditPurchase } from '@api/services/agent/credit-purchase';
import { generateCourseMeta } from '@api/services/agent/title-generation';
import { generateFieldText } from '@api/services/agent/text-generation';
import { isCourseTeamMemberOrOrgAdmin } from '@cio/db/queries/group';
import { getChatConversation, readCourseTodoList } from '@cio/db/queries/agent';
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
import {
  buildPlanProgressAnchor,
  buildTodoListAnchor,
  collectDocumentIds,
  getActiveCourseTemplateId,
  getLatestImplementationPlan,
  loadDocumentsContext,
  verifyExerciseBelongsToCourse,
  verifyLessonBelongsToCourse
} from '@api/services/agent/chat-context';
import { buildAgentTools } from '@api/services/agent/chat-tools';
import { buildModelContextMessages } from '@api/services/agent/model-context';
import { summarizeConversation } from '@api/services/agent/summarize';
import { agentHistoryRouter } from './history';
import { agentRunsRouter } from './runs';
import { agentDocumentsRouter } from './documents';

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

      const documentText =
        documentIds.length > 0
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
      // - plan: no plan AND the teacher is not viewing a lesson → pure planning
      //   conversation (wizard/discovery) → planning rules only (~6.6k tokens).
      // - full: no plan but a lesson is open — likely a single-lesson edit chat,
      //   which needs the content-writing rules; keep everything (safe fallback).
      // Each mode yields a stable, cacheable prefix; the one cache miss happens
      // at the plan→build transition, then the build prefix caches for the run.
      const teacherPromptMode: TeacherPromptMode =
        role === AgentRole.TEACHER ? (approvedPlan ? 'build' : context?.lessonId ? 'full' : 'plan') : 'full';

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

      // Coherence anchor: when a plan is being implemented, inject the REAL course
      // state (plan vs live structure — done/empty/missing per item) so the agent
      // can't lose track of progress when history is trimmed or falsely believe it
      // finished. Only when there's an approved plan (skip the extra query otherwise).
      if (approvedPlan) {
        try {
          const [progressItems, progressSections] = await Promise.all([
            getCourseContentItems(courseId),
            listCourseSections(courseId)
          ]);
          const progress = buildPlanProgressAnchor(approvedPlan, progressSections, progressItems);
          if (progress) {
            contextMessageText = contextMessageText
              ? `${contextMessageText}\n\n${progress.anchorText}`
              : progress.anchorText;
          }
        } catch (err) {
          // Never block the chat on the anchor — it's an enhancement, not required.
          console.error('[agent.chat] failed to build plan progress anchor:', err);
        }
      }

      // Task Manager anchor: surface the model's own persisted TODO list every turn
      // so it survives history trimming. Teachers only (students don't build courses).
      if (role === AgentRole.TEACHER) {
        try {
          const todos = await readCourseTodoList({ orgId, courseId, conversationId, userId: user.id });
          const todoAnchor = buildTodoListAnchor(todos);
          if (todoAnchor) {
            contextMessageText = contextMessageText ? `${contextMessageText}\n\n${todoAnchor}` : todoAnchor;
          }
        } catch (err) {
          // Additive safety net — never block the chat if the list can't be read.
          console.error('[agent.chat] failed to build todo list anchor:', err);
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

      // Prepend volatile context as a user-turn message so the stable system +
      // tools prefix stays cacheable even when the teacher navigates to a
      // different lesson or the agent creates sections mid-run.
      const contextMessage =
        contextMessageText.length > 0
          ? ({
              role: 'user' as const,
              content: [{ type: 'text' as const, text: contextMessageText }],
              // When the provider is Anthropic-compatible AND the context block
              // carries the document text (i.e. the cache is the inline kind),
              // tag THIS message with cache_control too. The cache hits read
              // the system + this context-with-PDF prefix at ~10% on the next
              // turn within the TTL window. Without this tag, the cache hint
              // sits on the system + the trailing user turn and never covers
              // the PDF block itself.
              ...(isAnthropicCompatible && hasInlineDocumentContext
                ? {
                    providerOptions: {
                      anthropic: { cacheControl: { type: 'ephemeral', ttl: '1h' } }
                    }
                  }
                : {})
            })
          : null;
      const modelMessages = contextMessage ? [contextMessage, ...builderMessages] : builderMessages;

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
      // - build: everything except the two questionnaire tools (discovery and
      //   template forms only run pre-plan). generate_course_plan STAYS — the
      //   shared "re-show the plan" rule and mid-build revisions need it.
      // - full (lesson-edit chat / students): no restriction.
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
              'update_course_landing_page',
              'check_course_go_live_readiness'
            ] as const)
          : role === AgentRole.TEACHER && teacherPromptMode === 'build'
            ? (Object.keys(agentTools).filter(
                (name) => name !== 'ask_template_questions' && name !== 'ask_discovery_questions'
              ) as Array<keyof typeof agentTools & string>)
            : undefined;

      // Capa 2b: reference the document's explicit cache (if one was created)
      // so its ~large text is billed at ~10% instead of re-sent inline.
      // Provider-agnostic: `documentCache.providerOptions` carries the
      // provider-specific shape (google.cachedContent for Gemini, anthropic
      // .cacheControl for MiniMax/Claude).
      const providerOptions = documentCache.providerOptions as
        | Parameters<typeof streamText>[0]['providerOptions']
        | undefined;
      if (documentCache.excludeDocumentId) {
        console.log(`[agent.chat] using document cache for document (${documentCache.excludeDocumentId})`);
      }

      const result = streamText({
        model,
        maxRetries: 2,
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
              emptyMessages: 'remove'
            })
          };
        },
        onStepFinish: () => {
          completedStepCount += 1;
        },
        onFinish: async ({ totalUsage, finishReason: resultFinishReason, steps }) => {
          completedStepCount = steps.length;
          finishReason = resultFinishReason;
          const durationMs = Date.now() - startTime;

          // Re-check the plan vs the (now-updated) live course. If items are still
          // missing/empty, flag it so the UI can offer "Continue" — regardless of
          // whether the model stopped by choice or hit the step limit.
          if (approvedPlan) {
            try {
              const [finalItems, finalSections] = await Promise.all([
                getCourseContentItems(courseId),
                listCourseSections(courseId)
              ]);
              const finalProgress = buildPlanProgressAnchor(approvedPlan, finalSections, finalItems);
              if (finalProgress && (finalProgress.pendingCount > 0 || finalProgress.emptyCount > 0)) {
                planIncomplete = {
                  pendingCount: finalProgress.pendingCount,
                  emptyCount: finalProgress.emptyCount
                };
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
              cacheWriteTokens: part.totalUsage.inputTokenDetails?.cacheWriteTokens
            },
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
  .route('/documents', agentDocumentsRouter);
