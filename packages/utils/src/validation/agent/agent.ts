import { z } from 'zod';
import { AGENT_MODEL_IDS } from '../../agent-models';

const ZAgentCourseId = z.string().min(1);
const ZAgentJsonRecord = z.record(z.string(), z.unknown());

export const AGENT_RUN_STATUSES = [
  'queued',
  'running',
  'waiting_for_input',
  'paused',
  'completed',
  'failed',
  'canceled'
] as const;

export const ZAgentRunStatus = z.enum(AGENT_RUN_STATUSES);
export type TAgentRunStatus = z.infer<typeof ZAgentRunStatus>;

// ─── POST /agent/chat ────────────────────────────────────────────────────────

export const ZAgentChatBody = z.object({
  courseId: ZAgentCourseId,
  conversationId: z.string().uuid().optional(),
  messages: z.array(z.any()), // UIMessage[] from Vercel AI SDK — validated by the SDK itself
  model: z.enum(AGENT_MODEL_IDS).optional(),
  context: z
    .object({
      lessonId: z.string().uuid().optional(),
      exerciseId: z.string().uuid().optional(),
      documentId: z.string().optional(),
      /** The locale the lesson editor is currently showing — content is written in this language. */
      locale: z.string().optional()
    })
    .optional()
});

export type TAgentChatBody = z.infer<typeof ZAgentChatBody>;

// ─── POST /agent/upload ──────────────────────────────────────────────────────

export const ZAgentUploadQuery = z.object({
  courseId: ZAgentCourseId,
  conversationId: z.string().uuid()
});

export type TAgentUploadQuery = z.infer<typeof ZAgentUploadQuery>;

// ─── GET /agent/status ───────────────────────────────────────────────────────

export const ZAgentStatusQuery = z.object({
  courseId: ZAgentCourseId
});

export type TAgentStatusQuery = z.infer<typeof ZAgentStatusQuery>;

// ─── POST /agent/credits ─────────────────────────────────────────────────────

export const ZAgentCreditsBody = z.object({
  amount: z.number().int().min(1)
});

export type TAgentCreditsBody = z.infer<typeof ZAgentCreditsBody>;

export const ZAgentCreditPurchase = z.object({
  orgId: z.string().uuid(),
  triggeredBy: z.string().uuid().optional(),
  providerOrderId: z.string().min(1),
  tokens: z.number().int().positive(),
  quantity: z.number().int().positive(),
  unitPriceCents: z.number().int().nonnegative(),
  currency: z.string().default('USD'),
  payload: z.record(z.string(), z.unknown()).optional()
});

export type TAgentCreditPurchase = z.infer<typeof ZAgentCreditPurchase>;

// ─── Supported MIME types ────────────────────────────────────────────────────

export const SUPPORTED_UPLOAD_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation'
] as const;

export const MAX_AGENT_DOCUMENT_SIZE = 25 * 1024 * 1024; // 25MB (keep in sync with @cio/ai-assistant)

// ─── GET /agent/history (list conversations) ────────────────────────────────

export const ZAgentHistoryQuery = z.object({
  courseId: ZAgentCourseId
});

export type TAgentHistoryQuery = z.infer<typeof ZAgentHistoryQuery>;

// ─── GET /agent/history/:conversationId ──────────────────────────────────────

export const ZAgentConversationParam = z.object({
  conversationId: z.string().uuid()
});

export type TAgentConversationParam = z.infer<typeof ZAgentConversationParam>;

// ─── POST /agent/history (create conversation) ──────────────────────────────

export const ZAgentConversationCreateBody = z.object({
  courseId: ZAgentCourseId,
  title: z.string().optional()
});

export type TAgentConversationCreateBody = z.infer<typeof ZAgentConversationCreateBody>;

// ─── PUT /agent/history/:conversationId (save messages) ──────────────────────

export const ZAgentHistorySaveBody = z.object({
  messages: z.array(z.any()),
  title: z.string().optional()
});

export type TAgentHistorySaveBody = z.infer<typeof ZAgentHistorySaveBody>;

// ─── PATCH /agent/history/:conversationId (rename only) ────────────────────

export const ZAgentHistoryRenameBody = z.object({
  title: z.string().min(1).max(120)
});

export type TAgentHistoryRenameBody = z.infer<typeof ZAgentHistoryRenameBody>;

// ─── DELETE /agent/history/:conversationId ───────────────────────────────────

export const ZAgentHistoryDeleteParam = z.object({
  conversationId: z.string().uuid()
});

export type TAgentHistoryDeleteParam = z.infer<typeof ZAgentHistoryDeleteParam>;

// ─── POST /agent/history/:conversationId/generate-title ──────────────────────

export const ZAgentGenerateTitleParam = z.object({
  conversationId: z.string().uuid()
});

export const ZAgentGenerateTitleBody = z.object({
  firstMessageText: z.string().min(1).max(500)
});

export type TAgentGenerateTitleParam = z.infer<typeof ZAgentGenerateTitleParam>;
export type TAgentGenerateTitleBody = z.infer<typeof ZAgentGenerateTitleBody>;

// ─── POST /agent/generate-course-title ───────────────────────────────────────

export const ZAgentGenerateCourseTitleBody = z.object({
  prompt: z.string().min(1).max(2000)
});

export type TAgentGenerateCourseTitleBody = z.infer<typeof ZAgentGenerateCourseTitleBody>;

// ─── POST /agent/summarize ────────────────────────────────────────────────────

export const ZAgentSummarizeBody = z.object({
  messages: z.array(z.any()),
  courseId: ZAgentCourseId
});

export type TAgentSummarizeBody = z.infer<typeof ZAgentSummarizeBody>;

// ─── POST /agent/generate-text ───────────────────────────────────────────────

export const ZAgentGenerateTextBody = z.object({
  prompt: z.string().min(1).max(1000),
  tone: z.enum(['professional', 'casual', 'expert', 'friendly']),
  format: z.enum(['plain', 'html']).default('plain'),
  context: z.string().max(500).optional(),
  courseId: z.string().uuid().optional()
});

export type TAgentGenerateTextBody = z.infer<typeof ZAgentGenerateTextBody>;

// ─── Agent durable runs ─────────────────────────────────────────────────────

export const ZAgentRunCourseQuery = z.object({
  courseId: ZAgentCourseId
});

export type TAgentRunCourseQuery = z.infer<typeof ZAgentRunCourseQuery>;

export const ZAgentRunParam = z.object({
  runId: z.string().uuid()
});

export type TAgentRunParam = z.infer<typeof ZAgentRunParam>;

export const ZAgentRunCreateBody = z.object({
  courseId: ZAgentCourseId,
  conversationId: z.string().uuid().optional(),
  phase: z.string().min(1).max(64).optional(),
  model: z.enum(AGENT_MODEL_IDS).optional(),
  approvedPlan: ZAgentJsonRecord.optional(),
  executionCursor: ZAgentJsonRecord.optional(),
  sourceIds: z.array(z.string().min(1)).optional(),
  modelSummary: z.string().max(100_000).optional()
});

export type TAgentRunCreateBody = z.infer<typeof ZAgentRunCreateBody>;

export const ZAgentRunInstructionBody = z.object({
  text: z.string().min(1).max(4_000)
});

export type TAgentRunInstructionBody = z.infer<typeof ZAgentRunInstructionBody>;

// ─── Sources (course documents attached to chat conversations) ────────────────

export const ZAgentDocumentsQuery = z.object({
  courseId: ZAgentCourseId,
  conversationId: z.string().uuid().optional()
});

export type TAgentDocumentsQuery = z.infer<typeof ZAgentDocumentsQuery>;

export const ZAgentDocumentParam = z.object({
  documentId: z.string().min(1)
});

export type TAgentDocumentParam = z.infer<typeof ZAgentDocumentParam>;

/** Body for adding a web page as a course source (POST /agent/documents/url). */
export const ZAgentDocumentUrlBody = z.object({
  courseId: ZAgentCourseId,
  /** Omitted when added from the Sources panel — the route creates the hidden
   *  "Course sources" conversation, matching how POST /agent/upload behaves. */
  conversationId: z.string().uuid().optional(),
  url: z.string().url()
});

export type TAgentDocumentUrlBody = z.infer<typeof ZAgentDocumentUrlBody>;

// ─── POST /agent/research ────────────────────────────────────────────────────

/** How much material a research run should gather. Mirrors RESEARCH_DEPTHS. */
export const AGENT_RESEARCH_DEPTHS = ['quick', 'normal', 'deep'] as const;

/**
 * Body for researching a topic on the web (POST /agent/research).
 *
 * `courseId` is optional on purpose: the course wizard runs research BEFORE the
 * course exists, and gets back draft document ids exactly like an upload from
 * that same screen.
 */
export const ZAgentResearchBody = z.object({
  topic: z.string().min(3).max(1000),
  depth: z.enum(AGENT_RESEARCH_DEPTHS).default('normal'),
  courseId: ZAgentCourseId.optional(),
  /**
   * Who the course is for, and how deep it goes.
   *
   * The same topic needs different material for different learners: colorimetry
   * for paint-shop staff wants colour charts and how to advise a customer, the
   * same words for formulation chemists want spectrophotometry and standards.
   * The query planner used to receive only the topic and could not tell those
   * apart, so both courses got the same pages.
   */
  audience: z.string().max(300).optional(),
  level: z.enum(['intro', 'intermediate', 'advanced']).optional()
});

export type TAgentResearchBody = z.infer<typeof ZAgentResearchBody>;

// ─── POST /agent/lessons/:lessonId/diagram ───────────────────────────────────

export const ZAgentDiagramParam = z.object({
  lessonId: z.string().uuid()
});

export type TAgentDiagramParam = z.infer<typeof ZAgentDiagramParam>;

export const ZAgentDiagramBody = z.object({
  courseId: ZAgentCourseId,
  locale: z.string().min(2).max(10),
  /** Position of the diagram within the lesson body, as enumerated by splitHtmlAndSvg. */
  index: z.number().int().min(0),
  /** Plain-language change request. Omitted means "redraw it better". */
  instruction: z.string().max(500).optional()
});

export type TAgentDiagramBody = z.infer<typeof ZAgentDiagramBody>;
