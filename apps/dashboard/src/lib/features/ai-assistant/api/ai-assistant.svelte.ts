import { BaseApiWithErrors, classroomio, apiClient, getRequestBaseUrl } from '$lib/utils/services/api';
import type {
  AgentConversation,
  AgentConversationCreateData,
  AgentConversationSummary,
  AgentStatusData,
  AiAssistantMessage,
  CompactConversationRequest,
  CompactConversationSuccess
} from '../utils/types';

class AiAssistantApi extends BaseApiWithErrors {
  status: AgentStatusData | null = $state(null);
  conversations: AgentConversationSummary[] = $state([]);
  currentConversation: AgentConversation | null = $state(null);

  async fetchStatus(courseId: string) {
    await this.execute<typeof classroomio.agent.status.$get>({
      requestFn: () =>
        classroomio.agent.status.$get({
          query: { courseId }
        }),
      logContext: 'fetching agent status',
      onSuccess: (result) => {
        this.status = result.data;
      }
    });
  }

  async listConversations(courseId: string) {
    await this.execute<typeof classroomio.agent.history.$get>({
      requestFn: () =>
        classroomio.agent.history.$get({
          query: { courseId }
        }),
      logContext: 'listing conversations',
      onSuccess: (result) => {
        this.conversations = result.data as AgentConversationSummary[];
      }
    });
  }

  async loadConversation(conversationId: string) {
    await this.execute<(typeof classroomio.agent.history)[':conversationId']['$get']>({
      requestFn: () =>
        classroomio.agent.history[':conversationId'].$get({
          param: { conversationId }
        }),
      logContext: 'loading conversation',
      onSuccess: (result) => {
        this.currentConversation = {
          ...(result.data as AgentConversation),
          messages: ((result.data as AgentConversation).messages ?? []) as AiAssistantMessage[]
        };
      }
    });
  }

  async createConversation(courseId: string, title?: string): Promise<{ id: string } | null> {
    let created: { id: string } | null = null;

    await this.execute<typeof classroomio.agent.history.$post>({
      requestFn: () =>
        classroomio.agent.history.$post({
          json: { courseId, title }
        }),
      logContext: 'creating conversation',
      onSuccess: (result) => {
        const newConversation = result.data as AgentConversationCreateData;
        created = newConversation;

        this.conversations = [
          { ...newConversation, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
          ...this.conversations
        ];
      }
    });

    return created;
  }

  async saveMessages(conversationId: string, messages: AiAssistantMessage[], title?: string) {
    await this.execute<(typeof classroomio.agent.history)[':conversationId']['$put']>({
      requestFn: () =>
        classroomio.agent.history[':conversationId'].$put({
          param: { conversationId },
          json: { messages, title }
        }),
      logContext: 'saving messages'
    });
  }

  async deleteConversation(conversationId: string) {
    await this.execute<(typeof classroomio.agent.history)[':conversationId']['$delete']>({
      requestFn: () =>
        classroomio.agent.history[':conversationId'].$delete({
          param: { conversationId }
        }),
      logContext: 'deleting conversation',
      onSuccess: () => {
        this.conversations = this.conversations.filter((c) => c.id !== conversationId);

        if (this.currentConversation?.id === conversationId) {
          this.currentConversation = null;
        }
      }
    });
  }

  async generateCourseMeta(prompt: string): Promise<{ title: string; description: string } | null> {
    let meta: { title: string; description: string } | null = null;

    await this.execute<(typeof classroomio.agent)['generate-course-title']['$post']>({
      requestFn: () =>
        classroomio.agent['generate-course-title'].$post({
          json: { prompt }
        }),
      logContext: 'generating course meta',
      onSuccess: (result) => {
        meta = (result as { data: { title: string; description: string } }).data;
      }
    });

    return meta;
  }

  async uploadDocument(
    file: File,
    courseId: string,
    conversationId: string
  ): Promise<{ documentId: string; fileName: string; wordCount: number; truncated: boolean } | null> {
    const formData = new FormData();
    formData.append('file', file);

    try {
      const url =
        `${getRequestBaseUrl()}/agent/upload` +
        `?courseId=${encodeURIComponent(courseId)}` +
        `&conversationId=${encodeURIComponent(conversationId)}`;

      const response = await apiClient.request(url, {
        method: 'POST',
        body: formData,
        credentials: 'include'
      });
      const result = (await response.json()) as {
        success: boolean;
        data?: { documentId: string; fileName: string; wordCount: number; truncated: boolean };
      };

      if (result.success && result.data) {
        return result.data;
      }
    } catch (error) {
      console.error('Error uploading document:', error);
      this.error = 'Failed to upload document';
    }

    return null;
  }

  async uploadDraftDocument(
    file: File
  ): Promise<{ documentId: string; fileName: string; wordCount: number; truncated: boolean } | null> {
    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await apiClient.request(`${getRequestBaseUrl()}/agent/upload-draft`, {
        method: 'POST',
        body: formData,
        credentials: 'include'
      });
      const result = (await response.json()) as {
        success: boolean;
        data?: { documentId: string; fileName: string; wordCount: number; truncated: boolean };
      };

      if (result.success && result.data) {
        return result.data;
      }
    } catch (error) {
      console.error('Error uploading draft document:', error);
      this.error = 'Failed to upload document';
    }

    return null;
  }

  /**
   * Research a topic on the web and get back draft sources.
   *
   * Returns the same currency as `uploadDraftDocument` — draft document ids —
   * so the wizard can hand researched pages and uploaded PDFs to the first chat
   * turn through one code path.
   *
   * The failure message is the server's own: this call needs GOOGLE_API_KEY on
   * the API, and "research failed" would send the one person who can fix that to
   * read logs instead.
   */
  async research(
    topic: string,
    depth: 'quick' | 'normal' | 'deep',
    options: {
      /** When set, the pages are stored as sources of that course straight away. */
      courseId?: string;
      /** Who the course is for — decides what counts as useful material. */
      audience?: string;
      level?: 'intro' | 'intermediate' | 'advanced';
    } = {}
  ): Promise<{
    queries: string[];
    sources: { documentId: string; title: string; url: string; chars: number }[];
    failedCount: number;
  } | null> {
    try {
      const response = await apiClient.request(`${getRequestBaseUrl()}/agent/research`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic,
          depth,
          ...(options.courseId ? { courseId: options.courseId } : {}),
          ...(options.audience ? { audience: options.audience } : {}),
          ...(options.level ? { level: options.level } : {})
        }),
        credentials: 'include'
      });
      const result = (await response.json()) as {
        success: boolean;
        error?: string;
        data?: {
          queries: string[];
          sources: { documentId: string; title: string; url: string; chars: number }[];
          failedCount: number;
        };
      };

      if (result.success && result.data) {
        return result.data;
      }

      this.error = result.error ?? 'Failed to research the topic';
    } catch (error) {
      console.error('Error researching topic:', error);
      this.error = error instanceof Error ? error.message : 'Failed to research the topic';
    }

    return null;
  }

  /**
   * Upload from the Sources panel: same endpoint as the chat upload but
   * without a conversationId. The backend will create a hidden "Course
   * sources" conversation if needed so the document has somewhere to live.
   */
  async uploadSourceDocument(
    file: File,
    courseId: string
  ): Promise<{ documentId: string; fileName: string; wordCount: number; truncated: boolean } | null> {
    const formData = new FormData();
    formData.append('file', file);

    try {
      const url = `${getRequestBaseUrl()}/agent/upload?courseId=${encodeURIComponent(courseId)}`;
      const response = await apiClient.request(url, {
        method: 'POST',
        body: formData,
        credentials: 'include'
      });
      const result = (await response.json()) as {
        success: boolean;
        data?: { documentId: string; fileName: string; wordCount: number; truncated: boolean };
      };

      if (result.success && result.data) {
        return result.data;
      }
    } catch (error) {
      console.error('Error uploading source document:', error);
      this.error = 'Failed to upload document';
    }

    return null;
  }

  async generateTitle(conversationId: string, firstMessageText: string): Promise<string | null> {
    let generatedTitle: string | null = null;

    await this.execute<(typeof classroomio.agent.history)[':conversationId']['generate-title']['$post']>({
      requestFn: () =>
        classroomio.agent.history[':conversationId']['generate-title'].$post({
          param: { conversationId },
          json: { firstMessageText }
        }),
      logContext: 'generating title',
      onSuccess: (result) => {
        generatedTitle = (result.data as { title: string }).title;

        // Update the title in the local conversations list
        this.conversations = this.conversations.map((c) =>
          c.id === conversationId ? { ...c, title: generatedTitle } : c
        );

        if (this.currentConversation?.id === conversationId) {
          this.currentConversation = { ...this.currentConversation, title: generatedTitle };
        }
      }
    });

    return generatedTitle;
  }

  async renameConversation(conversationId: string, title: string): Promise<string | null> {
    let newTitle: string | null = null;

    await this.execute<(typeof classroomio.agent.history)[':conversationId']['$patch']>({
      requestFn: () =>
        classroomio.agent.history[':conversationId'].$patch({
          param: { conversationId },
          json: { title }
        }),
      logContext: 'renaming conversation',
      onSuccess: (result) => {
        newTitle = (result.data as { id: string; title: string }).title;

        this.conversations = this.conversations.map((c) => (c.id === conversationId ? { ...c, title: newTitle } : c));

        if (this.currentConversation?.id === conversationId) {
          this.currentConversation = { ...this.currentConversation, title: newTitle };
        }
      }
    });

    return newTitle;
  }

  async summarizeConversation(messages: AiAssistantMessage[], courseId: string): Promise<string | null> {
    let summary: string | null = null;

    await this.execute<(typeof classroomio.agent)['summarize']['$post']>({
      requestFn: () =>
        classroomio.agent.summarize.$post({
          json: { messages, courseId }
        }),
      logContext: 'summarizing conversation',
      onSuccess: (result) => {
        summary = (result.data as { summary: string }).summary;
      }
    });

    return summary;
  }

  async compactConversation(conversationId: string): Promise<CompactConversationSuccess['data']['messages'] | null> {
    let compacted: CompactConversationSuccess['data']['messages'] | null = null;

    await this.execute<CompactConversationRequest>({
      requestFn: () =>
        classroomio.agent.history[':conversationId'].compact.$post({
          param: { conversationId }
        }),
      logContext: 'compacting conversation',
      onSuccess: (result) => {
        compacted = result.data.messages;

        if (this.currentConversation?.id === conversationId) {
          this.currentConversation = {
            ...this.currentConversation,
            messages: compacted as AiAssistantMessage[]
          };
        }
      }
    });

    return compacted;
  }
}

export const aiAssistantApi = new AiAssistantApi();
