import { Hono } from '@api/utils/hono';
import { authMiddleware } from '@api/middlewares/auth';
import { orgMemberMiddleware } from '@api/middlewares/org-member';
import { orgAdminMiddleware } from '@api/middlewares/org-admin';
import { authOrApiKeyMiddleware } from '@api/middlewares/auth-or-api-key';
import { agentContentTypeRewrite } from '@api/middlewares/agent-content-type';
import { handleError, AppError } from '@api/utils/errors';
import { zValidator } from '@hono/zod-validator';
import { streamText, stepCountIs, convertToModelMessages } from 'ai';
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
import { parseAndStoreDocument, parseDocument, storeDraftDocument } from '@api/services/agent/document';
import { resolveDocumentCache } from '@api/services/agent/gemini-cache';
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
  type AgentContext,
  type AgentStatus
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
          tutor: { enabled: false, capRemaining: null, cap: null, enforced: false }
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
        tutor
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

      const conversationId = c.req.query('conversationId');
      if (!conversationId) {
        throw new AppError('Conversation ID is required', 'CONVERSATION_ID_REQUIRED', 400);
      }

      const isTeamMember = await isCourseTeamMemberOrOrgAdmin(courseId, user.id);
      if (!isTeamMember) {
        throw new AppError('You must be a course team member to upload documents', 'NOT_COURSE_TEAM_MEMBER', 403);
      }

      const conversation = await getChatConversation(conversationId, user.id);
      if (!conversation || conversation.courseId !== courseId) {
        throw new AppError('Conversation not found', 'CONVERSATION_NOT_FOUND', 404);
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

      // Capa 2b: for a LARGE current document under Gemini, place it in an
      // explicit cache and reference it via providerOptions instead of re-sending
      // its full text every turn (~10% input cost). Fully defensive — an empty
      // result means "inline as before". Only teachers upload building material.
      const documentCache =
        role === AgentRole.TEACHER
          ? await resolveDocumentCache({
              provider: providerConfig.provider,
              currentDocumentId: context?.documentId,
              userId: user.id,
              redis
            })
          : {};

      const documentText =
        documentIds.length > 0
          ? await loadDocumentsContext(documentIds, context?.documentId, user.id, documentCache.excludeDocumentId)
          : undefined;

      const existingSections = await listCourseSections(courseId);

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

      // Stable across requests — safe to cache as a long-lived Anthropic prefix.
      // Volatile per-request context (lesson/exercise/document/section count/
      // approved plan/active template) is sent as a user-turn message instead so
      // it doesn't invalidate the tools+system cache.
      const systemPrompt = buildSystemPrompt(agentContext, {
        tutorSettings: studentPolicy?.settings,
        isOrgOnPaidPlan: isOrgPaid
      });

      let contextMessageText = buildContextMessage(agentContext, {
        template: activeTemplate,
        approvedPlan
      });

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
              conversationId
            });

      const contextManaged = await buildModelContextMessages({
        conversationId,
        courseId,
        userId: user.id,
        messages
      });
      const convertedMessages = sanitizeDanglingToolCalls(await convertToModelMessages(contextManaged.messages as any));
      let completedStepCount = 0;
      let finishReason: string | undefined;
      // Set in onFinish (async) so the sync messageMetadata callback can report to the
      // UI whether the plan is still incomplete — this drives the "Continue" button
      // even when the model wrongly claimed the course was finished.
      let planIncomplete: { pendingCount: number; emptyCount: number } | undefined;

      const isAnthropic = providerConfig.provider === AIProvider.ANTHROPIC;

      // 1h TTL keeps the prefix warm across tool-execution gaps in long agent
      // runs. Break-even is 3 requests within the hour; well under most plan-
      // execution loops.
      const systemContent = isAnthropic
        ? {
            role: 'system' as const,
            content: systemPrompt,
            providerOptions: {
              anthropic: { cacheControl: { type: 'ephemeral', ttl: '1h' } }
            }
          }
        : systemPrompt;

      // Prepend volatile context as a user-turn message so the stable system +
      // tools prefix stays cacheable even when the teacher navigates to a
      // different lesson or the agent creates sections mid-run.
      const modelMessages =
        contextMessageText.length > 0
          ? [
              { role: 'user' as const, content: [{ type: 'text' as const, text: contextMessageText }] },
              ...convertedMessages
            ]
          : convertedMessages;

      console.log(`[agent.chat] user=${user.id} messages=${modelMessages.length}`);

      // Cache the growing conversation prefix: each turn reads the prior
      // transcript at ~0.1x cost instead of reprocessing it at full price.
      if (isAnthropic && modelMessages.length > 0) {
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

      // Capa 2b: reference the document's Gemini explicit cache (if one was
      // created) so its ~large text is billed at ~10% instead of re-sent inline.
      const providerOptions = documentCache.cachedContentName
        ? { google: { cachedContent: documentCache.cachedContentName } }
        : undefined;
      if (documentCache.cachedContentName) {
        console.log(`[agent.chat] using gemini cachedContent for document (${documentCache.excludeDocumentId})`);
      }

      const result = streamText({
        model,
        maxRetries: 2,
        system: systemContent,
        messages: modelMessages,
        tools: agentTools,
        ...(providerOptions ? { providerOptions } : {}),
        stopWhen: stepCountIs(MAX_STEPS_PER_ROUND),
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
  .route('/runs', agentRunsRouter);
