import type { UIMessage } from 'ai';
import { classroomio, type InferResponseType } from '$lib/utils/services/api';
import type { CourseTemplateId } from '@cio/ai-assistant';

export interface UploadedDocument {
  id: string;
  name: string;
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

export interface AiAssistantMessageTokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
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

export interface AiAssistantMessageMetadata {
  attachment?: AiAssistantMessageAttachment;
  tokenUsage?: AiAssistantMessageTokenUsage;
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
