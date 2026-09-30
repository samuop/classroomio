import {
  AI_REQUEST_TIMEOUT,
  BaseApiWithErrors,
  classroomio,
  apiClient,
  getRequestBaseUrl,
  llamadaDeIA,
  opcionesDeIA
} from '$lib/utils/services/api';
import { t } from '$lib/utils/functions/translations';
import { esTiempoAgotado, leerErrorDeApi } from '../utils/errores-del-chat';
import { rondaVivaDe, type RondaViva } from '../utils/ronda-cortada';
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

  /**
   * La ronda del chat que esta persona tiene viva en el curso, preguntada al
   * servidor.
   *
   * Es la pregunta que se repite mientras el panel espera que una ronda termine
   * en el servidor, así que no pasa por `execute`: eso pisaría `error` e
   * `isLoading`, que otras pantallas leen, cada pocos segundos. De paso deja el
   * estado al día (el cupo baja mientras la ronda trabaja).
   *
   * `undefined` si no se pudo preguntar: no se sabe, que no es «no hay».
   *
   * Con `conversationId`, el servidor contesta por la ronda de ESA
   * conversación: otra ronda viva del curso (otra pestaña, otro chat) no hace
   * que el panel dé la suya por terminada.
   */
  async leerRondaViva(courseId: string, conversationId?: string): Promise<RondaViva | null | undefined> {
    try {
      const response = await classroomio.agent.status.$get({
        query: conversationId ? { courseId, conversationId } : { courseId }
      });
      const result = (await response.json()) as { success?: boolean; data?: AgentStatusData };

      if (!result?.success || !result.data) return undefined;

      this.status = result.data;

      return rondaVivaDe(result.data);
    } catch {
      return undefined;
    }
  }

  /**
   * «Detener»: la orden al servidor de cerrar la ronda viva de la conversación
   * después del paso en curso. Ver `POST /agent/chat/stop`.
   *
   * `undefined` si la orden no llegó (la red, un error): para la pantalla es lo
   * mismo que `'sin-redis'`, la ronda va a seguir hasta terminar. No pasa por
   * `execute`, por lo mismo que `leerRondaViva`.
   */
  async detenerRonda(
    courseId: string,
    conversationId: string
  ): Promise<'pedido' | 'sin-ronda' | 'sin-redis' | undefined> {
    try {
      const response = await classroomio.agent.chat.stop.$post({ json: { courseId, conversationId } });
      const result = (await response.json()) as { success?: boolean; data?: { stop?: string } };
      const stop = result?.success ? result.data?.stop : undefined;

      return stop === 'pedido' || stop === 'sin-ronda' || stop === 'sin-redis' ? stop : undefined;
    } catch {
      return undefined;
    }
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

  /**
   * Sube una imagen adjunta a un mensaje del chat y devuelve su dirección pública.
   *
   * Null si falla: quien llama marca la miniatura con error y el docente decide si
   * la quita o la vuelve a elegir.
   */
  async attachImage(
    file: File,
    courseId: string
  ): Promise<{ url: string; mediaType: string; filename: string } | null> {
    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await apiClient.request(
        `${getRequestBaseUrl()}/agent/attachments/image?courseId=${encodeURIComponent(courseId)}`,
        { method: 'POST', body: formData, credentials: 'include', ...opcionesDeIA(AI_REQUEST_TIMEOUT.upload) }
      );
      const result = (await response.json()) as {
        success: boolean;
        data?: { url: string; mediaType: string; filename: string };
      };

      if (result.success && result.data) {
        return result.data;
      }
    } catch (error) {
      console.error('Error attaching image:', error);
    }

    return null;
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
        credentials: 'include',
        ...opcionesDeIA(AI_REQUEST_TIMEOUT.upload)
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
      // El cuerpo de la respuesta, si vino: de ahí sale el `code` que la
      // pantalla traduce (el tope de fuentes, por ejemplo). Ver `claveDelErrorDeFuente`.
      this.error = error instanceof Error ? error.message : 'Failed to upload document';
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
        credentials: 'include',
        ...opcionesDeIA(AI_REQUEST_TIMEOUT.upload)
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
    /** Páginas que no entraron porque el curso llegó a su tope de fuentes. */
    leftOutByLimit?: number;
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
        credentials: 'include',
        // La profundidad normal tarda ~32 s y la profunda más: con los 30 s de
        // una pantalla común, el navegador abandonaba una búsqueda que el
        // servidor terminaba igual.
        ...opcionesDeIA(AI_REQUEST_TIMEOUT.research)
      });
      const result = (await response.json()) as {
        success: boolean;
        error?: string;
        data?: {
          queries: string[];
          sources: { documentId: string; title: string; url: string; chars: number }[];
          failedCount: number;
          leftOutByLimit?: number;
        };
      };

      if (result.success && result.data) {
        return result.data;
      }

      this.error = result.error ?? 'Failed to research the topic';
    } catch (error) {
      console.error('Error researching topic:', error);
      // Un vencimiento se dice en castellano y con lo que conviene hacer: el
      // texto crudo («Request timeout») era lo único que veía la docente, y
      // ganaba sobre la traducción de quien muestra este error. Lo mismo el
      // tope de fuentes. Del resto se muestra el texto del servidor, no el
      // JSON entero del cuerpo.
      const { code, detalle } = leerErrorDeApi(error);

      this.error = esTiempoAgotado(error)
        ? t.get('ai_assistant.error_timeout')
        : code === 'SOURCE_LIMIT_REACHED'
          ? t.get('course.sources.error_source_limit')
          : (detalle ?? (error instanceof Error ? error.message : 'Failed to research the topic'));
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
        credentials: 'include',
        ...opcionesDeIA(AI_REQUEST_TIMEOUT.upload)
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
      // Ver `uploadDocument`: el `code` del cuerpo decide el texto.
      this.error = error instanceof Error ? error.message : 'Failed to upload document';
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
        classroomio.agent.summarize.$post(
          {
            json: { messages, courseId }
          },
          llamadaDeIA(AI_REQUEST_TIMEOUT.summary)
        ),
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
        classroomio.agent.history[':conversationId'].compact.$post(
          {
            param: { conversationId }
          },
          llamadaDeIA(AI_REQUEST_TIMEOUT.summary)
        ),
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
