import type { UIMessage } from 'ai';
import { classroomio, type InferResponseType } from '$lib/utils/services/api';
import type { CourseTemplateId } from '@cio/ai-assistant';

export interface UploadedDocument {
  id: string;
  name: string;
  /**
   * Where the attachment came from, which decides whether it survives a turn.
   *
   * - `course_source`: pinned in the course's Sources panel. STICKY — it stays
   *   attached across turns so the material is in context for the whole plan →
   *   build flow. Dropping it after turn 1 meant the agent reached
   *   `generate_course_plan` holding only a short summary of the document.
   * - `one_off`: a file the teacher attached to a single message. Cleared once
   *   that message is answered, as before.
   */
  origin: 'course_source' | 'one_off';
}

export interface AiAssistantMessageAttachment {
  documentId: string;
  name: string;
}

// ─── Sources (course documents attached to chat conversations) ────────────────

/**
 * Metadata-only record for a document attached to the AI assistant for this
 * course. Returned by GET /agent/documents — the full text body is NOT
 * included; the chat loader reads it directly from DB when it actually needs
 * to inject the context.
 */
export interface CourseSource {
  id: string;
  conversationId: string;
  courseId: string;
  assetId: string | null;
  fileName: string;
  mimeType: string;
  wordCount: number;
  pageCount: number | null;
  createdAt: string;
}

export type CourseSourceMimeType = 'application/pdf' | 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' | 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

export interface CourseSourcesListSuccess {
  success: true;
  data: CourseSource[];
}

export interface CourseSourceDeleteSuccess {
  success: true;
  data: { id: string; assetId: string | null };
}

export type ListCourseSourcesRequest = typeof classroomio.agent.documents.$get;
export type DeleteCourseSourceRequest = (typeof classroomio.agent.documents)[':documentId']['$delete'];

/**
 * Per-document cache status surfaced by the Sources panel. `cached` is true
 * when there's a live Redis handle (so the next chat turn will read at ~10%
 * cost); `secondsRemaining` tells the UI how much lifetime is left.
 */
export interface DocumentCacheStatus {
  documentId: string;
  cached: boolean;
  provider: 'gemini' | 'anthropic' | null;
  expireAt: string | null;
  secondsRemaining: number | null;
}

export type GetCacheStatusRequest = (typeof classroomio.agent.documents)[':documentId']['cache-status']['$get'];
export type RefreshCacheRequest = (typeof classroomio.agent.documents)[':documentId']['refresh-cache']['$post'];
export type ReconcileSourcesRequest = typeof classroomio.agent.documents.reconcile.$post;
export type AddUrlSourceRequest = typeof classroomio.agent.documents.url.$post;

export interface AiAssistantMessageTokenUsage {
  // BILLING figures: aggregated across every step of the round, so a turn that
  // made 3 tool calls over a big document reports ~3x the document.
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /**
   * Input size of the LAST request sent to the provider — i.e. how full the
   * context window is. Must not be confused with `promptTokens`: using the
   * billing total as occupancy made a fresh conversation read 100% full.
   * Optional: absent on messages persisted before this field existed.
   */
  contextTokens?: number;
  // Optional breakdown reported by the provider (present for Gemini/Anthropic).
  reasoningTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

export type AiAssistantMessageContinuation =
  | {
      // The run hit the per-round step cap; more work may remain.
      reason: 'step_limit';
      maxSteps: number;
      finishReason?: string;
    }
  | {
      // The model stopped but the approved plan still has missing/empty items
      // (server compared plan vs live course). Drives the "Continue" button even
      // when the model wrongly claimed completion.
      reason: 'incomplete_plan';
      pendingCount: number;
      emptyCount: number;
      finishReason?: string;
    };

export type AiAssistantTemplateMetadata =
  | { id: CourseTemplateId }
  | { action: 'submit_template_answers'; templateId: CourseTemplateId; answers: Record<string, string> }
  | { action: 'skip_template_form'; templateId: CourseTemplateId };

export type AiAssistantDiscoveryMetadata =
  | { action: 'submit_discovery_answers'; formId: string; answers: Record<string, string> }
  | { action: 'skip_discovery_form'; formId: string };

export interface AiAssistantCompactionMetadata {
  compactedAt: string;
  originalMessageCount: number;
}

export interface AiAssistantPlanMetadata {
  action: 'implement_course_plan';
  payload?: unknown;
}

/**
 * Build progress as measured by the server: the approved plan reconciled against
 * the live course after the round's writes landed.
 *
 * This replaces the checklist that used to be drawn from the model's own
 * `update_course_todo_list` output. That number was a self-report — it read 1/32
 * while ten lessons already existed — because keeping it current cost the model a
 * tool call per item out of a 40-step budget, so it stopped paying.
 */
export interface AiAssistantPlanProgressItem {
  /** Plan-registry key (`s1`, `s1.2`); empty for plans created before the registry. */
  key: string;
  kind: 'section' | 'lesson' | 'exercise';
  title: string;
  /** `empty` = the row exists but has no content / no questions yet. */
  status: 'done' | 'empty' | 'missing';
}

export interface AiAssistantPlanProgress {
  total: number;
  completed: number;
  pendingCount: number;
  emptyCount: number;
  items: AiAssistantPlanProgressItem[];
}

export interface AiAssistantMessageMetadata {
  attachment?: AiAssistantMessageAttachment;
  tokenUsage?: AiAssistantMessageTokenUsage;
  planProgress?: AiAssistantPlanProgress;
  continuation?: AiAssistantMessageContinuation;
  template?: AiAssistantTemplateMetadata;
  discovery?: AiAssistantDiscoveryMetadata;
  plan?: AiAssistantPlanMetadata;
  compaction?: AiAssistantCompactionMetadata;
}

export type AiAssistantMessage = UIMessage<AiAssistantMessageMetadata>;

export type AgentStatusRequest = typeof classroomio.agent.status.$get;
export type AgentStatusSuccess = Extract<InferResponseType<AgentStatusRequest>, { success: true }>;
export type AgentStatusData = AgentStatusSuccess['data'];

export type AgentUsageRequest = typeof classroomio.agent.usage.$get;
export type AgentUsageSuccess = Extract<InferResponseType<AgentUsageRequest>, { success: true }>;
export type AgentUsageData = AgentUsageSuccess['data'];

export type AgentHistoryGetRequest = typeof classroomio.agent.history.$get;
export type AgentHistoryGetSuccess = Extract<InferResponseType<AgentHistoryGetRequest>, { success: true }>;
export type AgentHistoryData = AgentHistoryGetSuccess['data'];

export type AgentConversationSummary = AgentHistoryData[number];

export type AgentConversationRequest = (typeof classroomio.agent.history)[':conversationId']['$get'];
export type AgentConversationSuccess = Extract<InferResponseType<AgentConversationRequest>, { success: true }>;
export type AgentConversation = Omit<AgentConversationSuccess['data'], 'messages'> & {
  messages: AiAssistantMessage[];
};

export type AgentConversationCreateRequest = typeof classroomio.agent.history.$post;
export type AgentConversationCreateSuccess = Extract<
  InferResponseType<AgentConversationCreateRequest>,
  { success: true }
>;
export type AgentConversationCreateData = AgentConversationCreateSuccess['data'];

export type AgentHistorySaveRequest = (typeof classroomio.agent.history)[':conversationId']['$put'];

export type AgentHistoryRenameRequest = (typeof classroomio.agent.history)[':conversationId']['$patch'];

export type AgentHistoryDeleteRequest = (typeof classroomio.agent.history)[':conversationId']['$delete'];

export type CompactConversationRequest = (typeof classroomio.agent.history)[':conversationId']['compact']['$post'];
export type CompactConversationSuccess = Extract<InferResponseType<CompactConversationRequest>, { success: true }>;

export type GenerateCourseTitleRequest = (typeof classroomio.agent)['generate-course-title']['$post'];
export type GenerateCourseTitleSuccess = Extract<InferResponseType<GenerateCourseTitleRequest>, { success: true }>;
export type GenerateCourseTitleData = GenerateCourseTitleSuccess['data'];
