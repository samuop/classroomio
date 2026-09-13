<script lang="ts">
  import { tick, untrack } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import ChatHeader from '$features/ai-assistant/chat-header.svelte';
  import ChatMessageList from '$features/ai-assistant/chat-message-list.svelte';
  import ChatInput from '$features/ai-assistant/chat-input.svelte';
  import ContextFullState from '$features/ai-assistant/context-full-state.svelte';
  import { calculateContextUsage } from '$features/ai-assistant/utils/context-utils';
  import { resolve } from '$app/paths';
  import { getCompletedToolLine, getPendingToolLine, MUTATION_TOOLS } from '$features/ai-assistant/utils/tool-labels';
  import type { ProgressStep } from '$features/ai-assistant/utils/tool-labels';
  import {
    getAgentToolErrorText,
    getAgentToolInput,
    getAgentToolName,
    getAgentToolResult,
    getAgentToolStatus,
    isAgentToolPart,
    type AgentToolPart
  } from '$features/ai-assistant/utils/tool-parts';
  import {
    chatDraft,
    clearChatDraft,
    initialChatPrompt,
    initialChatTemplateId,
    initialChatDocumentIds,
    initialChatTemplateAnswers,
    clearInitialChatPrompt,
    clearInitialChatTemplateId,
    clearInitialChatDocumentIds,
    clearInitialChatTemplateAnswers,
    getLastSentText,
    setLastSentText,
    consumeRetry
  } from '$features/ai-assistant/utils/store';
  import { get } from 'svelte/store';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { Chat } from '@ai-sdk/svelte';
  import { DefaultChatTransport } from 'ai';
  import { courseApi, lessonApi } from '$features/course/api';
  import { getMentionableContent } from '$features/course/utils/content';
  import {
    getMentionRoute,
    resolveMention,
    type MentionRef,
    type MentionTarget
  } from '$features/ai-assistant/utils/mentions';
  import { snackbar } from '$features/ui/snackbar/store';
  import ImagePlusIcon from '@lucide/svelte/icons/image-plus';
  import { isFreePlan } from '$lib/utils/store/org';
  import { openUpgradeModal } from '$lib/utils/functions/org';
  import {
    MAXIMO_DE_IMAGENES_POR_MENSAJE,
    partesDeArchivo,
    puedeEnviar,
    revisarImagenes,
    type AdjuntoDeImagen
  } from '$features/ai-assistant/utils/chat-attachments';
  import { pantallaDelPlan, type PlanMostrado } from '$features/ai-assistant/utils/plan-screen.svelte';
  import { planesDeLaConversacion } from '$features/ai-assistant/utils/plan-summary';
  import type { CoursePlan } from '$features/ai-assistant/utils/course-plan';
  import type { NombrarPorId } from '$features/ai-assistant/utils/tool-labels';
  import { refreshExercisePageData } from '$features/course/utils/exercise-page-utils';
  import { getRequestBaseUrl, apiClient } from '$lib/utils/services/api';
  import { PUBLIC_IS_SELFHOSTED } from '$env/static/public';
  import { t } from '$lib/utils/functions/translations';
  import { aiAssistantApi } from '$features/ai-assistant/api/ai-assistant.svelte';
  import { sourcesApi } from '$features/ai-assistant/api/sources.svelte';
  import { profile } from '$lib/utils/store/user';
  import type {
    AiAssistantMessage,
    AiAssistantMessageMetadata,
    AiAssistantTemplateMetadata,
    UploadedDocument
  } from '$features/ai-assistant/utils/types';
  import { getCourseTemplate, type CourseTemplateId, type TemplateFormField } from '@cio/ai-assistant';
  import {
    AI_ASSISTANT_QUICK_ACTION_ENTRIES,
    STUDENT_QUICK_ACTION_ENTRIES
  } from '$features/ai-assistant/utils/constants';
  import {
    decidirContinuacion,
    frenoArmado,
    frenoInicial,
    type FrenoDeContinuacion
  } from '$features/ai-assistant/utils/auto-continue';

  /** Every ~30% / 60% / 90% of tool steps completed, refetch course so UI reflects partial mutations */
  const AGENT_STEP_PROGRESS_REFRESH_RATIOS = [0.3, 0.6, 0.9] as const;

  /** Completed-step thresholds already refreshed for this streaming session */
  let agentMutationProgressThresholdsTriggered = new SvelteSet<number>();
  let lastSeenStreamingFlag = false;

  const CONTINUE_IMPLEMENTATION_PROMPT = 'Continue implementing the plan from where you left off.';

  /**
   * Automatic build continuation. Starts OFF: only approving a plan or pressing
   * "Continue" turns it on — see `utils/auto-continue.ts` for why opening the
   * panel must not.
   */
  let freno = $state<FrenoDeContinuacion>(frenoInicial());

  // Read course id from the route. The chat panel is only mounted inside the
  // course content layout, so `page.params.id` is always the active course.
  const courseId = $derived(page.params?.id as string);

  // Extract current lessonId/exerciseId from route params
  const currentLessonId = $derived(page.params?.lessonId as string | undefined);
  const currentExerciseId = $derived(page.params?.exerciseId as string | undefined);

  let inputValue = $state('');
  let uploadedDocument: UploadedDocument | null = $state(null);
  let isUploading = $state(false);

  /** Imágenes del mensaje que se está escribiendo. Ver `chat-attachments.ts`. */
  let adjuntos = $state<AdjuntoDeImagen[]>([]);
  let arrastrandoImagen = $state(false);
  let profundidadDeArrastre = 0;

  let pendingInitialTemplateId: CourseTemplateId | null = $state(null);
  let pendingInitialDocumentIds: string[] = $state([]);
  let pendingInitialTemplateAnswers: Record<string, string> | null = $state(null);

  let statusFetchedForCourseId: string | null = $state(null);
  let conversationsLoadedForCourseId: string | null = $state(null);
  let sourcesLoadedForCourseId: string | null = $state(null);
  let activeConversationId: string | null = $state(null);

  /**
   * The last user-typed text the agent actually tried to send. Backed by a
   * module-level store (`setLastSentText` / `getLastSentText`) so other
   * components — notably the empty-course "Regenerate" button in
   * `lessons.svelte` — can read the same value and even issue a retry via
   * `requestRetry()` without needing the chat panel to be mounted.
   */
  const lastSentText: string | null = $derived(getLastSentText());

  /**
   * When another component (e.g. `lessons.svelte`) calls `requestRetry()`,
   * the flag flips to `true`. This effect consumes it and re-sends the
   * last text, so a "Regenerate" button on the empty course view works
   * even before the user has opened the chat.
   */
  $effect(() => {
    if (consumeRetry()) {
      void handleRetry();
    }
  });
  // The AI model/provider is chosen entirely server-side from the .env API key,
  // so the dashboard neither selects nor displays it. The request omits `model`
  // and the API resolves the provider itself.

  const tokenUsage = $derived(aiAssistantApi.status?.usage ?? null);

  function getStorageKey(courseId: string) {
    return `ai-chat-active-${courseId}`;
  }

  function getActiveConversationId(courseId: string): string | null {
    try {
      return localStorage.getItem(getStorageKey(courseId));
    } catch {
      return null;
    }
  }

  function setActiveConversationId(courseId: string, conversationId: string | null) {
    activeConversationId = conversationId;

    try {
      if (conversationId) {
        localStorage.setItem(getStorageKey(courseId), conversationId);
      } else {
        localStorage.removeItem(getStorageKey(courseId));
      }
    } catch {
      // localStorage unavailable
    }
  }

  async function loadConversation(conversationId: string) {
    if (!courseId) return;

    await aiAssistantApi.loadConversation(conversationId);

    const conversation = aiAssistantApi.currentConversation;

    if (conversation) {
      const loadedMessages = (conversation.messages ?? []) as AiAssistantMessage[];
      // Only overwrite in-memory messages if the loaded conversation actually has saved
      // messages. An empty result means the conversation was just created and the first
      // message hasn't been persisted yet — overwriting would wipe the optimistic message
      // that chat.sendMessage already placed in the UI.
      if (loadedMessages.length > 0) {
        chat.messages = loadedMessages;
      }
      setActiveConversationId(courseId, conversationId);
    }
  }

  async function startNewChat() {
    if (!courseId) return;

    const created = await aiAssistantApi.createConversation(courseId);

    if (created) {
      chat.messages = [];
      setActiveConversationId(courseId, created.id);
    }
  }

  async function handleDeleteConversation(conversationId: string) {
    if (!courseId) return;

    await aiAssistantApi.deleteConversation(conversationId);

    if (activeConversationId === conversationId) {
      chat.messages = [];
      setActiveConversationId(courseId, null);
    }
  }

  async function handleRenameConversation(conversationId: string, title: string) {
    const updatedTitle = await aiAssistantApi.renameConversation(conversationId, title);

    if (!updatedTitle) {
      const rawError = aiAssistantApi.error;
      let message = t.get('ai_assistant.rename_chat_failed');

      if (rawError && !rawError.startsWith('{')) {
        message = rawError;
      }

      throw new Error(message);
    }
  }

  // Fetch status and load conversations when the chat panel mounts (the
  // SidePanelRail only mounts this component while the panel is active) or
  // when the route's courseId changes.
  $effect(() => {
    if (!courseId) return;

    if (statusFetchedForCourseId !== courseId) {
      statusFetchedForCourseId = courseId;
      aiAssistantApi.fetchStatus(courseId);
    }

    if (conversationsLoadedForCourseId !== courseId) {
      conversationsLoadedForCourseId = courseId;

      // If the panel was just opened to start a fresh chat (e.g. via quoteInChat),
      // skip the auto-load so the draft effect can call startNewChat itself.
      const pendingDraft = get(chatDraft);

      if (pendingDraft?.mode === 'new') {
        return;
      }

      const listForCourseId = courseId;
      const savedId = getActiveConversationId(listForCourseId);

      aiAssistantApi.listConversations(listForCourseId).then(() => {
        if (courseId !== listForCourseId) return;

        if (activeConversationId) return;

        if (savedId) {
          loadConversation(savedId);
        } else if (aiAssistantApi.conversations.length > 0) {
          loadConversation(aiAssistantApi.conversations[0].id);
        }
      });
    }

    // Auto-load the course's Sources panel so the chat knows which documents
    // are available to inject into the prompt. On the first message of a
    // conversation we adopt the most recently uploaded source as the
    // attachment (the Sources panel is the single source of truth — there's
    // no per-message file upload UI for in-course chats anymore).
    if (sourcesLoadedForCourseId !== courseId) {
      sourcesLoadedForCourseId = courseId;
      void loadCourseSources(courseId);
    }
  });

  async function loadCourseSources(courseId: string) {
    // Hit the Sources panel API to mirror its state in the chat. The Sources
    // panel is the single place where sources are managed, so the chat just
    // observes what's available there instead of accepting its own uploads.
    await sourcesApi.listSources(courseId);
    // Fire the auto-sync reconciler in the background so any cache handles
    // that went stale between visits are rebuilt before the user sends their
    // first message. The reconciler is idempotent and best-effort.
    if (sourcesApi.sources.length > 0) {
      void sourcesApi.reconcileSources(courseId);
    }
  }

  function refreshCourseStateAfterChat() {
    const profileId = $profile.id;

    // Force refetch course data so new sections/lessons/exercises show in the UI
    if (courseId && profileId) {
      void courseApi.refreshCourse(courseId, profileId);
    }

    // Refresh current lesson content if viewing a lesson
    if (courseId && currentLessonId) {
      void lessonApi.get(courseId, currentLessonId);
    }

    // Refresh current exercise if viewing an exercise
    if (courseId && currentExerciseId) {
      void refreshExercisePageData(courseId, currentExerciseId);
    }

    // Refresh usage meter
    if (courseId) {
      void aiAssistantApi.fetchStatus(courseId);
    }
  }

  async function persistFinishedChat(messages: AiAssistantMessage[], conversationId: string | null) {
    if (conversationId) {
      await aiAssistantApi.saveMessages(conversationId, messages);

      // Generate a smart title after the first exchange (when title is still default)
      const activeConv = aiAssistantApi.conversations.find((c) => c.id === conversationId);
      const isDefaultTitle = !activeConv?.title || activeConv.title === 'New conversation';
      const firstUserMsg = messages.find((message) => message.role === 'user');
      const textPart = firstUserMsg?.parts?.find(
        (part): part is Extract<typeof part, { type: 'text' }> => part.type === 'text'
      );

      if (isDefaultTitle && textPart?.text) {
        await aiAssistantApi.generateTitle(conversationId, textPart.text.slice(0, 500));
      }

      return;
    }

    if (!courseId) return;

    // No active conversation yet — create one and save
    const created = await aiAssistantApi.createConversation(courseId);

    if (!created) return;

    setActiveConversationId(courseId, created.id);
    await aiAssistantApi.saveMessages(created.id, messages);

    const firstUserMsg = messages.find((message) => message.role === 'user');
    const textPart = firstUserMsg?.parts?.find(
      (part): part is Extract<typeof part, { type: 'text' }> => part.type === 'text'
    );

    if (textPart?.text) {
      await aiAssistantApi.generateTitle(created.id, textPart.text.slice(0, 500));
    }
  }

  const chat = new Chat({
    id: 'ai-assistant',
    transport: new DefaultChatTransport({
      api: `${getRequestBaseUrl()}/agent/chat`,
      credentials: 'include',
      body: () => ({
        courseId,
        conversationId: activeConversationId ?? undefined,
        context: {
          lessonId: page.params?.lessonId,
          exerciseId: page.params?.exerciseId,
          documentId: uploadedDocument?.id,
          // When a lesson is open, currentLocale was set to that lesson's editing
          // locale (lesson.svelte sets it to $profile.locale on mount). During course
          // generation from the chat there is NO open lesson, so currentLocale is still
          // its default 'en' — which mislabels Spanish content as English and makes the
          // editor show lessons as "empty". Fall back to the user's profile locale.
          locale: page.params?.lessonId ? lessonApi.currentLocale : $profile.locale
        }
      }),
      fetch: (input, init) => apiClient.request(input, init)
    }),
    onFinish: () => {
      // Keep course sources attached; only one-off per-message uploads are
      // cleared. The backend injects the FULL document text only for the id in
      // `context.documentId` — everything else in history degrades to a short
      // summary. Clearing unconditionally meant the material vanished after
      // turn 1, so by the time the teacher finished the discovery form the
      // agent was asked to plan "from the apuntes" with no apuntes in context.
      // Re-sending is cheap now: the provider serves the block from cache
      // (measured: 110,464 cached-read tokens on a plan turn).
      if (uploadedDocument?.origin !== 'course_source') {
        uploadedDocument = null;
      }

      refreshCourseStateAfterChat();
      void persistFinishedChat(chat.messages as AiAssistantMessage[], activeConversationId);
    },
    onError: () => {
      // A failed round must not be retried automatically — that is how a single
      // bad tool input turns into a loop that burns tokens. Hand control back.
      freno = { ...freno, habilitada: false };
    }
  });

  function buildTemplateAnswersSummary(
    templateId: CourseTemplateId,
    answers: Record<string, string>,
    fields: TemplateFormField[]
  ): string {
    const template = getCourseTemplate(templateId);
    const registryById = new Map((template?.fields ?? []).map((field) => [field.id, field]));
    const lines: string[] = ['Here are my answers for the course template:'];
    const seen = new Set<string>();

    for (const field of fields) {
      if (!field?.id || seen.has(field.id)) {
        continue;
      }

      seen.add(field.id);
      const trimmed = answers[field.id]?.trim() ?? '';

      if (!trimmed) {
        continue;
      }

      const label = registryById.get(field.id)?.label ?? field.label ?? field.id;
      lines.push(`- ${label}: ${trimmed}`);
    }

    // Capture any answers whose field isn't in the rendered list (defensive — shouldn't happen)
    for (const [fieldId, value] of Object.entries(answers)) {
      if (seen.has(fieldId)) continue;

      const trimmed = value.trim();
      if (!trimmed) continue;

      const label = registryById.get(fieldId)?.label ?? fieldId;
      lines.push(`- ${label}: ${trimmed}`);
    }

    return lines.join('\n');
  }

  async function handleSend(textOverride?: string) {
    /**
     * Sólo una cadena cuenta como texto a mandar.
     *
     * Esta función se pasa como manejador de eventos en varios lugares, y un
     * manejador recibe el evento como primer argumento: el botón de enviar le
     * entregaba un MouseEvent acá y `.trim()` reventaba, así que el botón no
     * hacía nada mientras Enter —que llama sin argumentos— funcionaba. El
     * guardia está en el lado que no se puede olvidar: cada call site nuevo
     * sería otra oportunidad de repetirlo, y el tipo no lo atrapa.
     */
    const override = typeof textOverride === 'string' ? textOverride : undefined;
    const text = (override ?? inputValue).trim();
    // Las imágenes viajan con lo que el docente escribió, nunca con un reintento
    // armado desde otra tarjeta. Una imagen sola alcanza para mandar.
    const archivos = override === undefined ? partesDeArchivo(adjuntos) : [];
    if (chat.status === 'streaming') return;
    if (override === undefined ? !puedeEnviar(text, adjuntos) : !text) return;
    if (!courseId) return;

    const userMessageCount = chat.messages.filter((message) => message.role === 'user').length;
    const isFirstMessage = userMessageCount === 0;
    const templateForFirstMessage = isFirstMessage ? pendingInitialTemplateId : null;

    // On the very first message, a wizard-uploaded draft document has no
    // `uploadedDocument` chip yet — adopt its id so the attachment + context
    // resolve to the draft (full-text injection on turn 1).
    const wizardDocumentIds = isFirstMessage ? [...pendingInitialDocumentIds] : [];

    if (isFirstMessage && !uploadedDocument && wizardDocumentIds.length > 0) {
      uploadedDocument = { id: wizardDocumentIds[0], name: 'document', origin: 'course_source' };
    }

    // Auto-adopt the most-recently-uploaded source from the Sources panel when
    // the chat was opened directly on the course (no draft was passed in from
    // the home page wizard). The Sources panel is the canonical place where
    // sources are managed; the chat input no longer has a per-message file
    // upload for in-course chats.
    //
    // Deliberately NOT gated on `isFirstMessage`: the attachment lives in
    // component state, so a page reload mid-conversation resets it to null and
    // a first-message-only rule would never re-attach the source for the rest
    // of the chat — the exact hole that starved the plan phase of its material.
    if (!uploadedDocument && pendingInitialDocumentIds.length === 0 && sourcesApi.sources.length > 0) {
      const latest = sourcesApi.sources[0];
      uploadedDocument = { id: latest.id, name: latest.fileName, origin: 'course_source' };
    }

    const messageAttachment = uploadedDocument
      ? {
          documentId: uploadedDocument.id,
          name: uploadedDocument.name,
          // Carry the wizard's other uploads too. Without this the server sees
          // exactly one id, so a teacher who dropped five PDFs got a course
          // built from the first one and four sources that silently expired.
          ...(wizardDocumentIds.length > 1 ? { documentIds: wizardDocumentIds } : {})
        }
      : undefined;

    const metadata: AiAssistantMessageMetadata = {};

    if (messageAttachment) {
      metadata.attachment = messageAttachment;
    }

    if (templateForFirstMessage) {
      // When the wizard already collected the template answers, send them as a
      // submission so the agent skips its own form; otherwise just activate the
      // template flow with the id marker.
      const templateMeta: AiAssistantTemplateMetadata =
        pendingInitialTemplateAnswers != null
          ? {
              action: 'submit_template_answers',
              templateId: templateForFirstMessage,
              answers: pendingInitialTemplateAnswers
            }
          : { id: templateForFirstMessage };
      metadata.template = templateMeta;
    }

    const conversationId = await ensureActiveConversation(courseId);
    if (!conversationId) return;

    if (templateForFirstMessage) {
      pendingInitialTemplateId = null;
      pendingInitialTemplateAnswers = null;
    }

    if (isFirstMessage) {
      pendingInitialDocumentIds = [];
    }

    // Only mutate the textarea when the user actually typed (not on a retry
    // call where the text came in as an override).
    if (override === undefined) {
      inputValue = '';
      limpiarAdjuntos();
    }

    if (text) setLastSentText(text);

    const extra = Object.keys(metadata).length > 0 ? { metadata } : {};

    chat.sendMessage(
      text
        ? { text, ...(archivos.length > 0 ? { files: archivos } : {}), ...extra }
        : { files: archivos, ...extra }
    );
  }

  /**
   * Re-sends the last user message. Used by the error banner's "Retry"
   * button so the user can recover from a transient failure (rate limit,
   * network blip, server restart) without retyping the prompt. No-op when
   * there is nothing to retry or the agent is currently streaming.
   */
  async function handleRetry() {
    const text = getLastSentText();
    if (!text) return;
    if (chat.status === 'streaming') return;
    setLastSentText(null);
    await handleSend(text);
  }

  async function handleSubmitTemplateAnswers(payload: {
    templateId: CourseTemplateId;
    answers: Record<string, string>;
    fields: TemplateFormField[];
  }) {
    if (!courseId || chat.status === 'streaming') {
      return;
    }

    const conversationId = await ensureActiveConversation(courseId);
    if (!conversationId) return;

    chat.sendMessage({
      text: buildTemplateAnswersSummary(payload.templateId, payload.answers, payload.fields),
      metadata: {
        template: {
          action: 'submit_template_answers',
          templateId: payload.templateId,
          answers: payload.answers
        }
      }
    });
  }

  async function handleSkipTemplateForm(payload: { templateId: CourseTemplateId }) {
    if (!courseId || chat.status === 'streaming') {
      return;
    }

    const conversationId = await ensureActiveConversation(courseId);
    if (!conversationId) return;

    chat.sendMessage({
      text: "I'll answer your questions in chat instead of the form.",
      metadata: {
        template: {
          action: 'skip_template_form',
          templateId: payload.templateId
        }
      }
    });
  }

  function buildDiscoveryAnswersSummary(answers: Record<string, string>, fields: TemplateFormField[]): string {
    const lines: string[] = ['Here are my answers to your questions:'];
    const seen = new Set<string>();

    for (const field of fields) {
      if (!field?.id || seen.has(field.id)) {
        continue;
      }

      seen.add(field.id);
      const trimmed = answers[field.id]?.trim() ?? '';

      if (!trimmed) {
        continue;
      }

      lines.push(`- ${field.label ?? field.id}: ${trimmed}`);
    }

    for (const [fieldId, value] of Object.entries(answers)) {
      if (seen.has(fieldId)) continue;

      const trimmed = value.trim();
      if (!trimmed) continue;

      lines.push(`- ${fieldId}: ${trimmed}`);
    }

    return lines.join('\n');
  }

  async function handleSubmitDiscoveryAnswers(payload: {
    formId: string;
    answers: Record<string, string>;
    fields: TemplateFormField[];
  }) {
    if (!courseId || chat.status === 'streaming') {
      return;
    }

    const conversationId = await ensureActiveConversation(courseId);
    if (!conversationId) return;

    chat.sendMessage({
      text: buildDiscoveryAnswersSummary(payload.answers, payload.fields),
      metadata: {
        discovery: {
          action: 'submit_discovery_answers',
          formId: payload.formId,
          answers: payload.answers
        }
      }
    });
  }

  async function handleSkipDiscoveryForm(payload: { formId: string }) {
    if (!courseId || chat.status === 'streaming') {
      return;
    }

    const conversationId = await ensureActiveConversation(courseId);
    if (!conversationId) return;

    chat.sendMessage({
      text: "I'll answer your questions in chat instead of the form.",
      metadata: {
        discovery: {
          action: 'skip_discovery_form',
          formId: payload.formId
        }
      }
    });
  }

  async function ensureActiveConversation(courseId: string): Promise<string | null> {
    if (activeConversationId) return activeConversationId;

    const created = await aiAssistantApi.createConversation(courseId);

    if (!created) return null;

    setActiveConversationId(courseId, created.id);

    return created.id;
  }

  async function handleFileSelect(file: File) {
    if (!courseId) return;

    const conversationId = await ensureActiveConversation(courseId);

    if (!conversationId) return;

    isUploading = true;
    const result = await aiAssistantApi.uploadDocument(file, courseId, conversationId);
    isUploading = false;

    if (result) {
      // A file the teacher attached to this specific message keeps the previous
      // behaviour (cleared once answered). Only the course's pinned sources are
      // sticky — widening it here would also change the chip's lifecycle in the
      // home-page wizard chat, which is not what this fix is about.
      uploadedDocument = { id: result.documentId, name: result.fileName, origin: 'one_off' };
    }
  }

  function handleRemoveDocument() {
    uploadedDocument = null;
  }

  function limpiarAdjuntos() {
    for (const adjunto of adjuntos) URL.revokeObjectURL(adjunto.vistaPrevia);
    adjuntos = [];
  }

  /**
   * Adjunta imágenes al mensaje en curso. Se suben apenas se eligen, en paralelo,
   * y el mensaje no sale hasta que terminan (`puedeEnviar`): así el envío no
   * espera una subida, y una imagen que falla se ve antes de mandar.
   */
  function agregarImagenes(archivos: File[]) {
    if (!courseId) return;

    const { aceptadas, rechazos } = revisarImagenes(archivos, adjuntos.length);
    let avisoDeCantidad = false;

    for (const { archivo, motivo } of rechazos) {
      if (motivo === 'cantidad') {
        if (!avisoDeCantidad) {
          snackbar.error(t.get('ai_assistant.attachments.rejected_count', { max: MAXIMO_DE_IMAGENES_POR_MENSAJE }));
        }
        avisoDeCantidad = true;
      } else {
        snackbar.error(
          t.get(
            motivo === 'tipo' ? 'ai_assistant.attachments.rejected_type' : 'ai_assistant.attachments.rejected_size',
            { name: archivo.name }
          )
        );
      }
    }

    for (const archivo of aceptadas) {
      const adjunto: AdjuntoDeImagen = {
        id: crypto.randomUUID(),
        nombre: archivo.name,
        tipo: archivo.type,
        vistaPrevia: URL.createObjectURL(archivo),
        estado: 'subiendo'
      };

      adjuntos = [...adjuntos, adjunto];
      void subirAdjunto(adjunto.id, archivo, courseId);
    }
  }

  async function subirAdjunto(id: string, archivo: File, paraCurso: string) {
    const subida = await aiAssistantApi.attachImage(archivo, paraCurso);

    // La quitaron mientras subía: no hay miniatura que actualizar.
    if (!adjuntos.some((adjunto) => adjunto.id === id)) return;

    if (!subida) {
      snackbar.error(t.get('ai_assistant.attachments.upload_failed', { name: archivo.name }));
    }

    adjuntos = adjuntos.map((adjunto) =>
      adjunto.id === id ? { ...adjunto, estado: subida ? 'lista' : 'error', url: subida?.url } : adjunto
    );
  }

  function quitarAdjunto(id: string) {
    const adjunto = adjuntos.find((item) => item.id === id);

    if (adjunto) URL.revokeObjectURL(adjunto.vistaPrevia);

    adjuntos = adjuntos.filter((item) => item.id !== id);
  }

  function traeArchivos(event: DragEvent) {
    return Array.from(event.dataTransfer?.types ?? []).includes('Files');
  }

  // Arrastrar sobre el panel entra y sale de cada hijo: se cuenta la profundidad
  // para que el aviso no parpadee al pasar por encima de un mensaje.
  function handleDragEnter(event: DragEvent) {
    if (!puedeAdjuntarImagenes || !traeArchivos(event)) return;

    event.preventDefault();
    profundidadDeArrastre += 1;
    arrastrandoImagen = true;
  }

  function handleDragOver(event: DragEvent) {
    if (!puedeAdjuntarImagenes || !traeArchivos(event)) return;

    event.preventDefault();
  }

  function handleDragLeave() {
    if (!arrastrandoImagen) return;

    profundidadDeArrastre = Math.max(0, profundidadDeArrastre - 1);
    if (profundidadDeArrastre === 0) arrastrandoImagen = false;
  }

  function handleDrop(event: DragEvent) {
    if (!puedeAdjuntarImagenes || !traeArchivos(event)) return;

    event.preventDefault();
    profundidadDeArrastre = 0;
    arrastrandoImagen = false;

    if ($isFreePlan) {
      openUpgradeModal();
      return;
    }

    const archivos = Array.from(event.dataTransfer?.files ?? []);

    if (archivos.length > 0) agregarImagenes(archivos);
  }

  function handleQuickAction(action: string) {
    inputValue = action;
    void handleSend();
  }

  function handleStop() {
    // Stopping is also the teacher's opt-out of the automatic build: without this
    // the effect below would immediately start the next round.
    freno = { ...freno, habilitada: false };
    chat.stop();
  }

  /**
   * Re-run a single failed action.
   *
   * The alternative the teacher had was Retry on the whole turn, which re-sends
   * the same instruction and re-does everything that already succeeded — on a
   * build round that can mean rewriting several lessons to fix one exercise.
   *
   * This sends a scoped instruction instead, naming the tool that failed and
   * quoting the error back, and says explicitly not to redo the rest. The plan
   * registry is what makes that safe: work already done is bound to real rows,
   * so re-entering the build cannot duplicate it.
   */
  function handleRetryStep(step: ProgressStep) {
    if (chat.status === 'streaming') return;
    if (!step.toolName) return;

    const detail = step.errorText ? ` El error fue: "${step.errorText}".` : '';

    inputValue =
      `La llamada a ${step.toolName} falló.${detail} ` +
      'Reintentá SOLO esa acción, corrigiendo lo que causó el error. ' +
      'No rehagas nada de lo que ya quedó completo en este turno.';

    void handleSend();
  }

  async function handleImplementPlan(editedPlan: unknown) {
    if (chat.status === 'streaming') return;
    if (!courseId) return;

    const conversationId = await ensureActiveConversation(courseId);
    if (!conversationId) return;

    // A freshly approved plan is a new build: clear any brake left over from the
    // previous one so it can run to completion on its own.
    resetAutoContinue();
    inputValue = '';

    chat.sendMessage({
      text: 'Implement this plan.',
      metadata: {
        plan: {
          action: 'implement_course_plan',
          payload: editedPlan
        }
      }
    });
  }

  // Bumped to focus the main chat input (from the plan card's "Request changes").
  let focusInputSignal = $state(0);

  /**
   * «Pedir cambios» desde la pantalla del plan.
   *
   * Viaja marcado en la metadata: con esa marca el servidor obliga al agente a
   * devolver un plan nuevo. Sin ella el pedido era un mensaje cualquiera, y el
   * modelo a veces contestaba «acá está el plan ajustado» sin ningún plan.
   */
  async function handleRequestPlanChanges(texto: string) {
    if (chat.status === 'streaming' || !courseId) return;

    const conversationId = await ensureActiveConversation(courseId);
    if (!conversationId) return;

    chat.sendMessage({
      text: texto,
      metadata: { plan: { action: 'request_plan_changes' } }
    });
  }

  function handleResume() {
    // Pressing "Continue" is the teacher choosing to build: it turns the
    // automatic continuation on for the rounds that follow.
    freno = { ...freno, habilitada: true };
    inputValue = CONTINUE_IMPLEMENTATION_PROMPT;
    void handleSend();
  }

  /**
   * Automatic continuation of an approved build.
   *
   * A course of any size needs more tool calls than MAX_STEPS_PER_ROUND allows, so
   * the round ends with `continuation` set and the teacher used to have to press
   * "Continue" — repeatedly, for a single approved plan they had already accepted.
   * This drives the next round itself.
   *
   * Three brakes, because a loop that spends tokens must not be able to run away:
   *  - a hard cap on rounds;
   *  - a stagnation check — if a whole round completes no new plan item, stop and
   *    leave the button to the teacher;
   *  - Stop (and any error) disables it until the teacher acts again.
   *
   * It only ever fires on server-measured progress (`planProgress`), never on the
   * model's claim that it has more to do.
   */
  function resetAutoContinue() {
    freno = frenoArmado();
  }

  $effect(() => {
    if (isStreaming) return;

    const messages = chat.messages as AiAssistantMessage[];
    const decision = decidirContinuacion(freno, messages[messages.length - 1]);

    if (decision.tipo === 'esperar') return;

    if (decision.tipo === 'frenar') {
      freno = { ...freno, habilitada: false };
      return;
    }

    freno = decision.freno;
    inputValue = CONTINUE_IMPLEMENTATION_PROMPT;
    void handleSend();
  });

  /**
   * Where a click on one of the agent's links goes.
   *
   * The render already repaired what it could (see `resolveMention`), but it
   * ran against the course as the chat had it at that moment — and right after
   * a build, the lesson the agent just wrote may not be loaded yet. So a link
   * that could not be verified is checked again here, after refreshing the
   * course once, instead of being trusted or thrown away. Only if it is still
   * nowhere does the teacher get a message, rather than a page that does not
   * exist.
   */
  async function handleMentionClick(route: string, mention?: MentionRef) {
    if (!mention || !courseId) {
      goto(resolve(route, {}));
      return;
    }

    let resolution = resolveMention(mention, mentionTargets);
    const profileId = $profile.id;

    if (resolution.status === 'unknown' && profileId) {
      await courseApi.refreshCourse(courseId, profileId);
      resolution = resolveMention(mention, buildMentionTargets());
    }

    if (resolution.status === 'unknown') {
      snackbar.error(t.get('ai_assistant.mention_not_found', { title: mention.title }));
      return;
    }

    goto(resolve(getMentionRoute(courseId, resolution.type, resolution.id), {}));
  }

  const isStreaming = $derived(chat.status === 'streaming' || chat.status === 'submitted');
  // Self-hosted has no monthly cap (own provider key), so it's never "exhausted".
  const isExhausted = $derived(
    PUBLIC_IS_SELFHOSTED !== 'true' && tokenUsage !== null && tokenUsage.remaining <= 0
  );

  const status = $derived(aiAssistantApi.status);
  const isStudent = $derived(status?.role === 'student');
  const tutorStatus = $derived(status?.tutor);

  /** Sólo el equipo del curso, y sólo si el modelo ve imágenes: lo decide el servidor. */
  const puedeAdjuntarImagenes = $derived(!!status?.imageInput && !isStudent);
  /** «Usarla en esta lección» tiene sentido con una lección abierta al lado. */
  const puedeUsarImagenEnLeccion = $derived(!!currentLessonId && !isStudent);

  // Context guard: measure the latest provider-reported request size against the
  // operational budget the server exposes (AGENT_CONTEXT_BUDGET). Teachers only —
  // students have short, capped tutor chats. Hidden until there's at least one
  // real usage report so a fresh chat doesn't show a bogus estimate.
  const contextUsage = $derived(
    !isStudent && status?.contextWindow
      ? calculateContextUsage(chat.messages as AiAssistantMessage[], status.contextWindow)
      : null
  );
  const showContextIndicator = $derived(!!contextUsage && chat.messages.length > 0);
  const showContextFull = $derived(!!contextUsage?.isFull && !isStreaming);

  // 'compact' summarizes the current conversation in place; 'new_chat' starts a
  // fresh conversation seeded with a handoff summary of this one.
  let contextFullBusy: null | 'compact' | 'new_chat' = $state(null);

  async function handleCompactConversation() {
    if (!activeConversationId || contextFullBusy) return;
    contextFullBusy = 'compact';
    try {
      const compacted = await aiAssistantApi.compactConversation(activeConversationId);
      if (compacted) {
        chat.messages = compacted as AiAssistantMessage[];
      }
    } finally {
      contextFullBusy = null;
    }
  }

  async function handleStartNewChatWithSummary() {
    if (!courseId || contextFullBusy) return;
    contextFullBusy = 'new_chat';
    try {
      // Carry a handoff summary of the current chat into the new one so the
      // teacher doesn't lose context. Falls back to a plain new chat if
      // summarization fails or there's nothing to summarize.
      const summary =
        activeConversationId && chat.messages.length > 0
          ? await aiAssistantApi.summarizeConversation(chat.messages as AiAssistantMessage[], courseId)
          : null;

      const created = await aiAssistantApi.createConversation(courseId);
      if (!created) return;

      if (summary) {
        const seed: AiAssistantMessage = {
          id: crypto.randomUUID(),
          role: 'user',
          parts: [{ type: 'text', text: summary }],
          metadata: { compaction: { compactedAt: new Date().toISOString(), originalMessageCount: chat.messages.length } }
        } as AiAssistantMessage;
        chat.messages = [seed];
        await persistFinishedChat(chat.messages as AiAssistantMessage[], created.id);
      } else {
        chat.messages = [];
      }
      setActiveConversationId(courseId, created.id);
    } finally {
      contextFullBusy = null;
    }
  }

  const tutorErrorCode = $derived.by(() => {
    if (!chat.error) return null;
    const message = chat.error.message ?? '';
    if (message.includes('AI_TUTOR_DISABLED')) return 'AI_TUTOR_DISABLED' as const;
    if (message.includes('LEARNER_CAP_REACHED')) return 'LEARNER_CAP_REACHED' as const;
    if (message.includes('POOL_EXHAUSTED')) return 'POOL_EXHAUSTED' as const;
    return null;
  });

  const tutorBlocked = $derived.by(() => {
    if (!isStudent) return null;
    if (tutorErrorCode) return tutorErrorCode;
    if (tutorStatus && tutorStatus.enabled === false) return 'AI_TUTOR_DISABLED' as const;
    if (tutorStatus && tutorStatus.enforced && tutorStatus.capRemaining !== null && tutorStatus.capRemaining <= 0) {
      return 'LEARNER_CAP_REACHED' as const;
    }
    return null;
  });

  const quickActions = $derived(isStudent ? [...STUDENT_QUICK_ACTION_ENTRIES] : [...AI_ASSISTANT_QUICK_ACTION_ENTRIES]);

  // Student-facing per-learner monthly cap (100 messages). Hidden when the agent reports
  // no tutor data (e.g. provider unconfigured) so we don't render a 0/0 bar.
  const studentMessageUsage = $derived.by(() => {
    if (!isStudent || !tutorStatus || tutorStatus.cap == null || tutorStatus.capRemaining == null) {
      return null;
    }

    return {
      used: Math.max(0, tutorStatus.cap - tutorStatus.capRemaining),
      cap: tutorStatus.cap
    };
  });

  const mentionItems = $derived(
    getMentionableContent(courseApi.course).map((item) => ({
      id: item.id,
      label: item.title,
      type: item.type
    }))
  );

  /** The course as the agent's links are checked against it. See `resolveMention`. */
  function buildMentionTargets(): MentionTarget[] {
    return getMentionableContent(courseApi.course).map((item) => ({
      id: item.id,
      title: item.title,
      type: String(item.type).toLowerCase() as MentionTarget['type']
    }));
  }

  const mentionTargets = $derived(buildMentionTargets());

  /**
   * Nombres para la línea de «qué está haciendo»: las herramientas traen ids, y
   * el docente quiere leer «Leyendo "Manual de seguridad.pdf"», no un id.
   */
  const nombrar: NombrarPorId = (id) =>
    sourcesApi.sources.find((fuente) => fuente.id === id)?.fileName ??
    mentionTargets.find((item) => item.id === id)?.title;

  /**
   * Las fuentes del curso no se muestran en el chat. El agente ya las tiene todas,
   * y el chat adjunta sola la última a cada mensaje: mostrarla parecía una
   * elección del docente y ocupaba lugar debajo de cada pregunta. Se administran
   * en «Fuentes».
   */
  const esFuenteDelCurso = (documentId: string) => sourcesApi.sources.some((fuente) => fuente.id === documentId);

  // ─── La pantalla del plan ──────────────────────────────────────────────────

  const planes = $derived(planesDeLaConversacion(chat.messages as AiAssistantMessage[]));
  const planVigente = $derived(planes.at(-1) ?? null);

  /**
   * El plan vigente tal como se aprobó, o null si todavía no se aprobó.
   *
   * El docente puede editar títulos y descripciones antes de aprobar, y lo que se
   * construye es esa versión editada: es la que tiene que verse después, y la que
   * el servidor usa para medir el avance.
   */
  const planAprobado = $derived.by((): CoursePlan | null => {
    if (!planVigente) return null;

    const mensajes = chat.messages as AiAssistantMessage[];
    const desde = mensajes.findIndex((mensaje) => mensaje.id === planVigente.messageId);

    for (let indice = mensajes.length - 1; indice > desde; indice -= 1) {
      const plan = mensajes[indice]?.role === 'user' ? mensajes[indice].metadata?.plan : undefined;

      if (plan?.action === 'implement_course_plan') {
        const aprobado = plan.payload as CoursePlan | undefined;

        return aprobado && Array.isArray(aprobado.sections) ? aprobado : planVigente.plan;
      }
    }

    return null;
  });

  const ultimoProgreso = $derived.by(() => {
    const mensajes = chat.messages as AiAssistantMessage[];

    for (let indice = mensajes.length - 1; indice >= 0; indice -= 1) {
      const progreso = mensajes[indice]?.role === 'assistant' ? mensajes[indice].metadata?.planProgress : undefined;

      if (progreso && progreso.total > 0) return progreso;
    }

    return null;
  });

  $effect(() => {
    pantallaDelPlan.sincronizar({
      vigente: planVigente ? { id: planVigente.id, plan: planAprobado ?? planVigente.plan } : null,
      aprobado: !!planAprobado,
      ocupado: isStreaming,
      progreso: ultimoProgreso
    });
  });

  /**
   * Un plan que llega en vivo se abre solo: es la respuesta a lo que el docente
   * acaba de pedir. Uno que ya estaba en el historial al abrir la conversación,
   * no — reabrir el chat no es pedir el plan otra vez.
   */
  let ultimoPlanVisto: string | null = null;

  $effect(() => {
    const id = planVigente?.id ?? null;

    if (id === ultimoPlanVisto) return;

    ultimoPlanVisto = id;

    if (id && planVigente && untrack(() => isStreaming)) {
      pantallaDelPlan.mostrar({ id, plan: planVigente.plan });
    }
  });

  $effect(() =>
    pantallaDelPlan.conectar({
      aprobar: (plan) => void handleImplementPlan(plan),
      pedirCambios: (texto) => void handleRequestPlanChanges(texto)
    })
  );

  function handleOpenPlan(plan: PlanMostrado) {
    // La versión vigente, si ya se aprobó, se muestra como se aprobó.
    if (planVigente && plan.id === planVigente.id && planAprobado) {
      pantallaDelPlan.mostrar({ id: plan.id, plan: planAprobado });
      return;
    }

    pantallaDelPlan.mostrar(plan);
  }

  function handleOpenLatestPlan() {
    if (planVigente) handleOpenPlan({ id: planVigente.id, plan: planVigente.plan });
  }

  /**
   * Pedirle al asistente que ponga una imagen adjunta en la lección abierta.
   *
   * Es un mensaje, no una edición directa: dónde va la imagen lo decide el
   * contenido de la lección, y eso lo lee el agente.
   */
  function handleUseImageInLesson(url: string) {
    if (chat.status === 'streaming') return;

    void handleSend(t.get('ai_assistant.attachments.use_in_lesson_prompt', { url }));
  }

  // Show an activity card whenever the agent calls any tool.
  // Hides automatically once the agent finishes cleanly; stays visible if stopped mid-way.
  const planExecutionState = $derived.by(() => {
    const lastMsg = chat.messages[chat.messages.length - 1];

    if (!lastMsg) return null;

    // If the most recent message is from the user, the agent has not produced a
    // reply yet — don't show the previous assistant's tool card. While streaming
    // is starting up, fall through to the thinking placeholder below.
    if (lastMsg.role !== 'assistant') {
      if (!isStreaming) return null;

      return {
        steps: [
          {
            status: 'in_progress' as const,
            line: { shape: 'i18n' as const, key: 'ai_assistant.plan_thinking' }
          }
        ],
        currentActionLine: undefined,
        isStopped: false,
        titleKey: 'ai_assistant.plan_working',
        hasMutations: false
      };
    }

    const lastAssistantMsg = lastMsg;

    const continuation = (lastAssistantMsg.metadata as AiAssistantMessageMetadata | undefined)?.continuation;
    // Three ways a round can end with work still to do: it hit the step cap, the
    // server found the approved plan still incomplete, or the reply was cut off at
    // the output-token ceiling. All three offer a "Continue" — the last one used to
    // offer nothing, which is how a 5-minute turn could build nothing and say so.
    const reachedStepLimit = continuation?.reason === 'step_limit';
    const planIncomplete = continuation?.reason === 'incomplete_plan';
    const hitOutputLimit = continuation?.reason === 'output_limit';
    const canResume = reachedStepLimit || planIncomplete || hitOutputLimit;
    const allToolParts = lastAssistantMsg.parts.filter((part: Record<string, unknown>) =>
      isAgentToolPart(part)
    ) as AgentToolPart[];

    // Self-rendered tools show their own card (PlanView, forms) — exclude them
    // from the generic activity-card step list.
    const toolParts = allToolParts.filter((part) => {
      const toolName = getAgentToolName(part);
      return (
        toolName !== 'generate_course_plan' &&
        toolName !== 'ask_template_questions' &&
        toolName !== 'ask_discovery_questions'
      );
    });

    if (toolParts.length === 0) {
      if (!isStreaming) return null;

      // The agent is mid-turn (reasoning / preparing a tool call) but hasn't emitted
      // a real tool part yet. Show a placeholder step so the user always sees activity.
      return {
        steps: [
          {
            status: 'in_progress' as const,
            line: { shape: 'i18n' as const, key: 'ai_assistant.plan_thinking' }
          }
        ],
        currentActionLine: undefined,
        isStopped: false,
        titleKey: 'ai_assistant.plan_working',
        hasMutations: false
      };
    }

    const steps: ProgressStep[] = toolParts.flatMap((part) => {
      const toolName = getAgentToolName(part);

      if (!toolName) {
        return [];
      }

      const result = getAgentToolResult(part) as Record<string, unknown> | undefined;
      const status = getAgentToolStatus(part);
      const line =
        status === 'completed'
          ? getCompletedToolLine(toolName, result)
          : getPendingToolLine(toolName, getAgentToolInput(part));

      // toolName/errorText ride along so a failed row can offer a scoped retry
      // instead of forcing a re-send of the whole turn.
      return [
        {
          line,
          status,
          toolName,
          ...(status === 'failed' ? { errorText: getAgentToolErrorText(part) } : {})
        }
      ];
    });

    const allDone = steps.every((s) => s.status === 'completed');
    const isStopped = !isStreaming && (!allDone || canResume);

    // Hide the card once the agent finishes cleanly — the text response takes over.
    // But keep it (to show the Continue button) when the plan is still incomplete.
    if (allDone && !isStreaming && !canResume) return null;

    const hasMutations = toolParts.some((part) => {
      const toolName = getAgentToolName(part);
      return toolName ? MUTATION_TOOLS.includes(toolName) : false;
    });
    const titleKey = hasMutations ? 'ai_assistant.plan_applying_changes' : 'ai_assistant.plan_working';
    const currentActionLine = steps.find((s) => s.status === 'in_progress')?.line;
    const pendingSummary = planIncomplete
      ? { pendingCount: continuation.pendingCount, emptyCount: continuation.emptyCount }
      : undefined;

    return { steps, currentActionLine, isStopped, titleKey, hasMutations, pendingSummary };
  });

  $effect(() => {
    const streamingNow = isStreaming;

    if (streamingNow && !lastSeenStreamingFlag) {
      agentMutationProgressThresholdsTriggered.clear();
    }

    lastSeenStreamingFlag = streamingNow;
  });

  $effect(() => {
    if (!isStreaming) {
      return;
    }

    const state = planExecutionState;

    if (!state?.hasMutations || state.isStopped) {
      return;
    }

    const total = state.steps.length;

    if (total === 0) {
      return;
    }

    const completedStepCount = state.steps.filter((s) => s.status === 'completed').length;
    const stepThresholds = [
      ...new Set(
        AGENT_STEP_PROGRESS_REFRESH_RATIOS.map((ratio) => Math.min(total, Math.max(1, Math.ceil(total * ratio))))
      )
    ].sort((a, b) => a - b);

    for (const threshold of stepThresholds) {
      if (completedStepCount >= threshold && !agentMutationProgressThresholdsTriggered.has(threshold)) {
        agentMutationProgressThresholdsTriggered.add(threshold);

        refreshCourseStateAfterChat();
      }
    }
  });

  const conversationTitle = $derived(
    aiAssistantApi.conversations.find((c) => c.id === activeConversationId)?.title ?? null
  );

  $effect(() => {
    const prompt = $initialChatPrompt;

    if (!prompt || !courseId) return;

    const templateFromHome = $initialChatTemplateId;
    const documentIdsFromHome = $initialChatDocumentIds;
    const templateAnswersFromHome = $initialChatTemplateAnswers;
    clearInitialChatPrompt();
    clearInitialChatTemplateId();
    clearInitialChatDocumentIds();
    clearInitialChatTemplateAnswers();

    tick().then(() => {
      pendingInitialTemplateId = templateFromHome ?? null;
      pendingInitialDocumentIds = documentIdsFromHome ?? [];
      pendingInitialTemplateAnswers = templateAnswersFromHome ?? null;

      inputValue = prompt;
      void handleSend();
    });
  });

  $effect(() => {
    const draft = $chatDraft;

    if (!draft || !draft.text) {
      return;
    }

    clearChatDraft();

    if (draft.mode === 'new') {
      void startNewChat().then(() =>
        tick().then(() => {
          inputValue = `${draft.text}\n\n`;
        })
      );

      return;
    }

    void tick().then(() => {
      const existing = inputValue.trimEnd();

      inputValue = existing ? `${draft.text}\n\n${existing}` : `${draft.text}\n\n`;
    });
  });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="relative flex min-h-0 flex-1 flex-col"
  ondragenter={handleDragEnter}
  ondragover={handleDragOver}
  ondragleave={handleDragLeave}
  ondrop={handleDrop}
>
  <ChatHeader
    {tokenUsage}
    {isStudent}
    {studentMessageUsage}
    {conversationTitle}
    conversations={aiAssistantApi.conversations}
    {activeConversationId}
    isNewChatDisabled={chat.messages.length === 0}
    onNewChat={startNewChat}
    onLoadConversation={loadConversation}
    onDeleteConversation={handleDeleteConversation}
    onRenameConversation={handleRenameConversation}
  />

  <!--
    The context gauge lives in the composer (passed to ChatInput below), beside
    Send/Stop. It used to sit in its own strip under the header, far from any
    decision it informs; next to the button it is in view exactly when the
    teacher is about to spend more of the window.
  -->
  <ChatMessageList
    messages={chat.messages}
    {isStreaming}
    {isStudent}
    {courseId}
    resumeState={planExecutionState}
    {quickActions}
    onQuickAction={handleQuickAction}
    latestPlanId={planVigente?.id ?? null}
    onOpenPlan={handleOpenPlan}
    onOpenLatestPlan={handleOpenLatestPlan}
    {nombrar}
    {esFuenteDelCurso}
    onUseImageInLesson={puedeUsarImagenEnLeccion ? handleUseImageInLesson : undefined}
    onSubmitTemplateAnswers={handleSubmitTemplateAnswers}
    onSkipTemplateForm={handleSkipTemplateForm}
    onSubmitDiscoveryAnswers={handleSubmitDiscoveryAnswers}
    onSkipDiscoveryForm={handleSkipDiscoveryForm}
    onRetryStep={handleRetryStep}
    onResume={handleResume}
    onMentionClick={handleMentionClick}
    {mentionTargets}
  />

  <!--
    The "context full" panel is a WARNING shown above the composer, never a
    replacement for it. It used to be an {:else} branch, so a context reading at
    100% removed the input entirely and the only ways out (compact / new chat)
    both spend tokens. That turned any over-reading into a hard lock — and the
    reading was over-reporting, because it used the round's aggregated billing
    total as occupancy. Even with an accurate gauge, the teacher must keep the
    ability to type: if the window genuinely overflows, the provider errors and
    onError now surfaces that.
  -->
  {#if showContextFull}
    <ContextFullState
      {contextFullBusy}
      compactConversationDisabled={!activeConversationId}
      isCompactionWorthwhile={contextUsage?.isCompactionWorthwhile ?? true}
      onCompactConversation={handleCompactConversation}
      onStartNewChat={handleStartNewChatWithSummary}
    />
  {/if}

  <ChatInput
      bind:inputValue
      {isStreaming}
      {isExhausted}
      {isUploading}
      uploadedDocument={uploadedDocument?.origin === 'one_off' ? uploadedDocument : null}
      {mentionItems}
      {isStudent}
      {tutorBlocked}
      focusSignal={focusInputSignal}
      error={chat.error}
      canRetry={!!lastSentText && !isStreaming}
      contextUsage={showContextIndicator ? contextUsage : undefined}
      onSend={handleSend}
      onRetry={handleRetry}
      onStop={handleStop}
      onFileSelect={handleFileSelect}
      onRemoveDocument={handleRemoveDocument}
      attachments={adjuntos}
      canAttachImages={puedeAdjuntarImagenes}
      canSend={puedeEnviar(inputValue, adjuntos)}
      onAddImages={agregarImagenes}
      onRemoveAttachment={quitarAdjunto}
    />

  {#if arrastrandoImagen}
    <div
      class="pointer-events-none absolute inset-2 z-20 flex flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed border-(--primary) bg-(--background)/90 text-center"
    >
      <ImagePlusIcon size={22} class="ui:text-primary" />
      <p class="text-sm font-medium">{$t('ai_assistant.attachments.drop_here')}</p>
      <p class="ui:text-muted-foreground text-xs">{$t('ai_assistant.attachments.drop_hint')}</p>
    </div>
  {/if}
</div>
