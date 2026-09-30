<script lang="ts">
  import { onDestroy, tick, untrack } from 'svelte';
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
    setReintentoDisponible,
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
  import { AI_REQUEST_TIMEOUT, getRequestBaseUrl, apiClient, opcionesDeIA } from '$lib/utils/services/api';
  import { reportIncident } from '$lib/utils/services/audit/report-incident';
  import { aprobacionVigente, estadoDelPlan, ultimoTurnoDelDocente } from '$features/ai-assistant/utils/aprobacion';
  import {
    mensajeDeControl,
    textoDelMensaje,
    TEXTO_DE_APROBACION,
    TEXTO_DE_CONTINUACION
  } from '$features/ai-assistant/utils/mensajes-de-control';
  import {
    cerrarHerramientasColgadas,
    clasificarFinDeRonda,
    conversacionTrasLaRonda,
    esperarFinDeRonda,
    hayQueEsperarAlServidor,
    laLocalTieneMasQueElServidor,
    laRecargaResuelveElError
  } from '$features/ai-assistant/utils/ronda-cortada';
  import { claveDelErrorDeFuente, esRondaEnCurso } from '$features/ai-assistant/utils/errores-del-chat';
  import { claveDeConversacionActiva, planDelCurso } from '$features/ai-assistant/utils/plan-del-curso.svelte';
  import { PUBLIC_IS_SELFHOSTED } from '$env/static/public';
  import { t } from '$lib/utils/functions/translations';
  import { aiAssistantApi } from '$features/ai-assistant/api/ai-assistant.svelte';
  import { sourcesApi } from '$features/ai-assistant/api/sources.svelte';
  import { profile } from '$lib/utils/store/user';
  import { conIdsUnicos } from './utils/ids-unicos';
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
   * La conversación cuya ronda sigue viva en el servidor mientras este panel la
   * espera: la de un stream que se cortó, la de un pedido rechazado con 409, o
   * la que ya estaba trabajando cuando se abrió el panel. Mientras dura, no se
   * puede mandar nada (sería una segunda ronda sobre la misma conversación) y al
   * terminar se recarga lo que el servidor guardó.
   */
  let rondaEnCurso = $state<string | null>(null);
  const esperandoRonda = $derived(rondaEnCurso !== null && rondaEnCurso === activeConversationId);

  /**
   * El stream de la última ronda se cortó después de empezar. Se avisa con su
   * propio texto hasta que la conversación recargada trae el turno completo.
   */
  let avisoDeCorte = $state(false);

  /**
   * La docente tocó «Detener» y el servidor recibió la orden: la ronda termina
   * el paso en curso y cierra. Dura hasta que termina el stream.
   */
  let deteniendo = $state(false);

  /**
   * Llegaron las cabeceras del pedido en curso: el servidor aceptó el turno y la
   * ronda arrancó. Es lo que distingue un corte del stream (la ronda sigue en el
   * servidor) de un pedido que falló antes de llegar. Lo escribe el `fetch` del
   * transporte.
   */
  let respuestaIniciada = false;

  /** El panel se cerró: nada de lo que quedó esperando tiene que seguir. */
  let destruido = false;

  onDestroy(() => {
    destruido = true;
    // El turno que falló vive en la memoria de este panel: sin él, «Regenerar»
    // no tiene qué reintentar.
    setReintentoDisponible(false);
  });

  /**
   * «Rehacé el plan» escrito desde la pantalla de Fuentes: si la docente lo
   * manda, viaja como pedido de cambios al plan. Ver `ChatDraft.rehacerPlan`.
   */
  let borradorPideRehacerPlan = $state(false);

  /**
   * When another component (e.g. `lessons.svelte`) calls `requestRetry()`,
   * the flag flips to `true`. This effect consumes it and retries the turn
   * that failed.
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
    return claveDeConversacionActiva(courseId);
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
      const loadedMessages = conIdsUnicos((conversation.messages ?? []) as AiAssistantMessage[]);
      // Only overwrite in-memory messages if the loaded conversation actually has saved
      // messages. An empty result means the conversation was just created and the first
      // message hasn't been persisted yet — overwriting would wipe the optimistic message
      // that chat.sendMessage already placed in the UI.
      if (loadedMessages.length > 0) {
        chat.messages = loadedMessages;
      }
      setActiveConversationId(courseId, conversationId);

      // Una ronda de esta conversación puede seguir en el servidor: la que este
      // mismo panel perdió al recargar, o la que otra pestaña dejó andando. Lo
      // guardado es de antes de esa ronda; se avisa y se espera a que termine.
      void esperarRondaDelServidor(conversationId, { recargarAunqueNoSiga: false, limpiarErrorSiTrae: true });
    }
  }

  /**
   * La conversación guardada por el servidor, puesta en el panel si trae el
   * turno completo. Ver `conversacionTrasLaRonda`.
   *
   * Devuelve qué pasó: `trajo` si la reemplazó; `guardar-la-local` si lo
   * guardado no trae la respuesta a medias que el panel muestra (ver
   * `laLocalTieneMasQueElServidor`); `nada` en lo demás. No pisa nada si
   * mientras cargaba cambió la conversación, se cerró el panel, o arrancó otra
   * ronda.
   */
  async function recargarConversacion(conversationId: string): Promise<'trajo' | 'guardar-la-local' | 'nada'> {
    const firma = (mensajes: AiAssistantMessage[]) => `${mensajes.length}:${mensajes.at(-1)?.id ?? ''}`;
    const antes = firma(chat.messages as AiAssistantMessage[]);

    await aiAssistantApi.loadConversation(conversationId);

    const guardada = aiAssistantApi.currentConversation;

    if (destruido || isStreaming || activeConversationId !== conversationId) return 'nada';
    if (!guardada || guardada.id !== conversationId) return 'nada';

    const local = chat.messages as AiAssistantMessage[];

    if (firma(local) !== antes) return 'nada';

    const servidor = conIdsUnicos((guardada.messages ?? []) as AiAssistantMessage[]);
    const resultado = conversacionTrasLaRonda(local, servidor);

    if (resultado === local) return laLocalTieneMasQueElServidor(local, servidor) ? 'guardar-la-local' : 'nada';

    chat.messages = resultado;

    return 'trajo';
  }

  /**
   * Espera a que la ronda de la conversación termine en el servidor y recarga
   * lo que guardó (contrato con la API: la ronda termina y se guarda aunque el
   * navegador se vaya).
   *
   * Pregunta enseguida: si no hay ronda viva no se avisa nada. Mientras la hay,
   * el panel dice que el asistente está trabajando, no deja mandar, y refresca
   * el curso cada tanto para que lo construido vaya apareciendo.
   *
   * @param recargarAunqueNoSiga recargar aunque la ronda ya no esté viva en la
   *   primera pregunta. Después de un pedido que falló hace falta: la ronda pudo
   *   haber terminado entre el corte y la pregunta. Al abrir una conversación
   *   recién cargada, no.
   * @param limpiarErrorSiTrae sacar la banda de error si la recarga trae el
   *   turno completo. Sólo cuando el error era del camino (un corte, el reloj
   *   del navegador) y no de la ronda: ver `laRecargaResuelveElError`.
   * @param guardarLaParcial guardar la respuesta a medias si el servidor no la
   *   tiene. Sólo tras un corte o un fallo, donde el proceso del servidor pudo
   *   morir; tras un «Detener» que no llegó la ronda sigue y guarda ella.
   */
  async function esperarRondaDelServidor(
    conversationId: string | null,
    opciones: { recargarAunqueNoSiga: boolean; limpiarErrorSiTrae?: boolean; guardarLaParcial?: boolean }
  ): Promise<void> {
    const curso = courseId;

    if (!conversationId || !curso || destruido) return;

    let seVioViva = false;

    const resultado = await esperarFinDeRonda({
      conversationId,
      // Por ESTA conversación: otra ronda viva del curso no es la suya.
      leerRondaViva: () => aiAssistantApi.leerRondaViva(curso, conversationId),
      alSeguirViva: (vuelta) => {
        seVioViva = true;
        rondaEnCurso = conversationId;

        if (vuelta % 5 === 0) refrescarCurso();
      },
      // Si este panel arrancó su propia ronda, la ronda viva es esa: la sigue su
      // stream, no esta espera.
      cancelada: () => destruido || isStreaming || courseId !== curso || activeConversationId !== conversationId
    });

    if (resultado === 'cancelada') {
      if (rondaEnCurso === conversationId) rondaEnCurso = null;
      return;
    }

    if (!seVioViva && !opciones.recargarAunqueNoSiga) {
      // Sin ronda viva, una herramienta que quedó «trabajando» en lo guardado —
      // una ronda cortada que un panel anterior guardó así— no va a terminar
      // nunca: se muestra cerrada en vez de girar para siempre.
      cerrarHerramientasSinTerminar();
      return;
    }

    // `rondaEnCurso` se suelta DESPUÉS de recargar: en el medio, un mensaje nuevo
    // quedaría pisado por la conversación que llega del servidor.
    const recarga = await recargarConversacion(conversationId);
    const trajoElTurno = recarga === 'trajo';

    if (rondaEnCurso === conversationId) rondaEnCurso = null;

    cerrarHerramientasSinTerminar();
    refreshCourseStateAfterChat();

    // La ronda ya murió y el servidor no guardó lo que la pantalla muestra (se
    // reinició a mitad de camino): se guarda la parcial, con lo colgado ya
    // cerrado, para que no desaparezca al recargar la página. Con la ronda
    // muerta no hay guardado del servidor que pisar.
    if (recarga === 'guardar-la-local' && opciones.guardarLaParcial) {
      void aiAssistantApi.saveMessages(conversationId, chat.messages as AiAssistantMessage[]);
    }

    if (trajoElTurno) avisoDeCorte = false;

    // La ronda ya no está viva: el aviso de un 409 («todavía está trabajando»)
    // deja de ser cierto aunque lo guardado no haya traído esta conversación.
    // Cualquier otro error se queda con su «Reintentar», salvo que fuera del
    // camino y la recarga haya traído el turno que el servidor sí terminó.
    if ((trajoElTurno && opciones.limpiarErrorSiTrae) || esRondaEnCurso(chat.error)) chat.clearError();
  }

  /** Ver `cerrarHerramientasColgadas`. Nunca durante una ronda propia. */
  function cerrarHerramientasSinTerminar() {
    if (isStreaming) return;

    const mensajes = chat.messages as AiAssistantMessage[];
    const cerrados = cerrarHerramientasColgadas(mensajes, t.get('ai_assistant.tool_interrupted'));

    if (cerrados !== mensajes) chat.messages = cerrados;
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

  function refrescarCurso() {
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
  }

  function refreshCourseStateAfterChat() {
    refrescarCurso();

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
      fetch: async (input, init) => {
        respuestaIniciada = false;

        // Su propio reloj hasta las cabeceras (una red de seguridad: la espera
        // real es la del stream, que este reloj no mide) y SIN reintento
        // automático: reenviar este POST ante un 502 arrancaba otra ronda.
        const respuesta = await apiClient.request(input, { ...init, ...opcionesDeIA(AI_REQUEST_TIMEOUT.chat) });

        respuestaIniciada = true;

        return respuesta;
      }
    }),
    onFinish: ({ isAbort, isDisconnect, isError, finishReason }) => {
      const conversationId = activeConversationId;
      const fin = clasificarFinDeRonda({
        isAbort,
        isDisconnect,
        isError,
        finishReason,
        respuestaIniciada,
        error: chat.error
      });

      // El adjunto viaja con el turno que lo llevó, y nada más. Una fuente del
      // curso quedaba pegada y salía como `context.documentId` en CADA pedido:
      // en construcción el servidor la cargaba entera, presentada como «el PDF
      // que el docente acaba de adjuntar» (medido: una página ajena de la
      // investigación viajó en cada paso de una construcción). Después del
      // primer turno ya es fuente del curso y le llega al agente con las demás.
      // Si el pedido no llegó a arrancar, se conserva para el reintento.
      if (respuestaIniciada) {
        uploadedDocument = null;
      }

      refreshCourseStateAfterChat();
      deteniendo = false;

      if (fin === 'completa') {
        void persistFinishedChat(chat.messages as AiAssistantMessage[], conversationId);
        return;
      }

      // Lo que quedó «trabajando» no va a devolver nada por este stream.
      cerrarHerramientasSinTerminar();

      // Detenida, cortada, fallida o rechazada: NO se guarda nada a medias. El
      // servidor termina la ronda y guarda la conversación entera; se espera a
      // que la ronda deje de estar viva y se recarga eso (contrato con la API).
      // Guardar lo parcial acá pisaba lo completo si la ronda terminaba justo
      // mientras viajaba el guardado.
      if (fin === 'rechazada') devolverMensajeRechazado();

      // Un error con estado antes de las cabeceras es la respuesta del servidor:
      // no hay ronda que esperar, y la banda de error se queda como está.
      if (!hayQueEsperarAlServidor(fin, { respuestaIniciada, error: chat.error })) return;

      if (fin === 'cortada') {
        avisoDeCorte = true;
        // El corte llega cuando el cliente de la API ya devolvió la respuesta,
        // así que nadie más lo ve: sin este reporte no quedaba rastro.
        reportIncident({
          kind: 'REQUEST_FAILED',
          message: 'Stream cut',
          route: '/agent/chat',
          method: 'POST',
          status: 0,
          ...(conversationId ? { metadata: { conversationId } } : {})
        });
      }

      void esperarRondaDelServidor(conversationId, {
        recargarAunqueNoSiga: true,
        limpiarErrorSiTrae: laRecargaResuelveElError(fin, chat.error),
        guardarLaParcial: fin === 'cortada' || fin === 'fallida'
      });
    },
    onError: () => {
      // A failed round must not be retried automatically — that is how a single
      // bad tool input turns into a loop that burns tokens. Hand control back.
      freno = { ...freno, habilitada: false };
    }
  });

  /**
   * El servidor rechazó el pedido con 409: esa conversación ya tiene una ronda
   * viva (otra pestaña, o una ronda que este panel dio por cortada y sigue).
   *
   * El mensaje no se procesó ni se va a procesar: se saca de la conversación, y
   * si era algo que la docente escribió, vuelve al compositor para que lo mande
   * cuando la ronda termine. No se reintenta solo.
   */
  function devolverMensajeRechazado() {
    const mensajes = chat.messages as AiAssistantMessage[];
    const rechazado = mensajes.at(-1);

    if (rechazado?.role !== 'user') return;

    chat.messages = mensajes.slice(0, -1);

    const metadata = rechazado.metadata;
    const escrito = !mensajeDeControl(rechazado) && !metadata?.template && !metadata?.discovery && !metadata?.plan;
    const texto = textoDelMensaje(rechazado);

    if (escrito && texto && !inputValue.trim()) inputValue = texto;
  }

  /** Nada sale mientras hay una ronda en curso: la propia, o una viva en el servidor. */
  function puedeMandarAhora(): boolean {
    return !isStreaming && !esperandoRonda;
  }

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
    if (!puedeMandarAhora()) return;
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

    // Ya NO se adopta sola la fuente más nueva del panel de Fuentes. Viajaba como
    // `context.documentId` en cada pedido, y en construcción el servidor la
    // cargaba entera como «el PDF que el docente acaba de adjuntar»; después de
    // recargar, la elegida era la última agregada —medido: la pantalla de inicio
    // de sesión de una planilla privada—. Las fuentes del curso le llegan al
    // agente todas, en el paquete de fuentes o en el índice, sin adjuntarlas.

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

    // «Rehacé el plan», escrito desde Fuentes: viaja como pedido de cambios al
    // plan, que obliga al servidor a devolver un plan nuevo. Sólo lo consume lo
    // que la docente manda del compositor, no una continuación automática.
    if (override === undefined) {
      if (borradorPideRehacerPlan && planVigente) {
        metadata.plan = { action: 'request_plan_changes' };
      }

      borradorPideRehacerPlan = false;
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

    avisoDeCorte = false;

    const extra = Object.keys(metadata).length > 0 ? { metadata } : {};

    chat.sendMessage(
      text
        ? { text, ...(archivos.length > 0 ? { files: archivos } : {}), ...extra }
        : { files: archivos, ...extra }
    );
  }

  /**
   * «Reintentar»: vuelve a pedir el turno que falló, el mismo, sin agregar una
   * copia.
   *
   * Antes reenviaba «el último texto escrito» como un mensaje nuevo. Ese valor
   * sólo lo actualizaba lo que se escribía a mano, así que después de aprobar el
   * plan reintentar mandaba otra vez la descripción original del curso, y el
   * mensaje que había fallado quedaba sin respuesta en la conversación.
   *
   * `regenerate()` del SDK reenvía la conversación tal como está: si el último
   * mensaje es el del docente, lo vuelve a pedir con su texto, sus partes y su
   * metadata (la aprobación viaja con su `metadata.plan`); si hay una respuesta
   * cortada después, la saca primero.
   *
   * Un 409 no se reintenta: la conversación tiene otra ronda viva y el panel ya
   * la está esperando.
   */
  async function handleRetry() {
    if (!puedeReintentar) return;

    const turno = ultimoTurnoDelDocente(chat.messages as AiAssistantMessage[]);

    if (!turno) return;

    // El error apagó la continuación automática. Reintentar una aprobación es
    // volver a aprobar, y reintentar «Continuar» es volver a elegir construir:
    // los dos la encienden, como el gesto original.
    if (turno.control === 'aprobacion') resetAutoContinue();
    else if (turno.control === 'continuacion') freno = { ...freno, habilitada: true };

    avisoDeCorte = false;

    await chat.regenerate();
  }

  async function handleSubmitTemplateAnswers(payload: {
    templateId: CourseTemplateId;
    answers: Record<string, string>;
    fields: TemplateFormField[];
  }) {
    if (!courseId || !puedeMandarAhora()) {
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
    if (!courseId || !puedeMandarAhora()) {
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
    if (!courseId || !puedeMandarAhora()) {
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
    if (!courseId || !puedeMandarAhora()) {
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
      return;
    }

    // Fallaba en silencio: el archivo no aparecía y nada decía por qué. El
    // curso lleno tiene su propio texto (ver `claveDelErrorDeFuente`).
    snackbar.error(t.get(claveDelErrorDeFuente(aiAssistantApi.error, 'course.sources.upload_failed')));
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

  /**
   * «Detener»: la orden al servidor de cerrar la ronda después del paso en curso.
   *
   * Antes cortaba el stream y nada más. Desde que la ronda termina en el
   * servidor aunque el navegador se vaya, eso ya no frenaba nada: el servidor
   * seguía escribiendo lecciones y cobrando hasta el tope de pasos, el panel
   * quedaba trabado esperándolo, y encima guardaba lo parcial por encima de lo
   * que el servidor guardaba entero.
   *
   * Ahora manda la orden y NO corta el stream: lo que se estaba haciendo termina
   * y se ve llegar, la ronda cierra sola y el final es un final normal. Si la
   * orden no se pudo dejar (sin Redis, sin red), corta el stream como antes,
   * avisa que la ronda va a terminar igual, y espera a que el servidor la guarde.
   */
  async function handleStop() {
    // Stopping is also the teacher's opt-out of the automatic build: without this
    // the effect below would immediately start the next round.
    freno = { ...freno, habilitada: false };

    if (deteniendo) return;

    const conversationId = activeConversationId;
    const curso = courseId;

    if (!conversationId || !curso) {
      chat.stop();
      return;
    }

    deteniendo = true;

    const orden = await aiAssistantApi.detenerRonda(curso, conversationId);

    // La ronda cierra sola después del paso en curso; el stream termina con ella.
    if (orden === 'pedido') return;

    deteniendo = false;

    if (!isStreaming || activeConversationId !== conversationId) return;

    // `sin-ronda`: la ronda justo terminó, o todavía no había arrancado en el
    // servidor. No hay nada que avisar: el corte de abajo alcanza.
    if (orden !== 'sin-ronda') snackbar.error(t.get('ai_assistant.stop_not_delivered'));

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
    if (!puedeMandarAhora()) return;
    if (!step.toolName) return;

    const detail = step.errorText ? ` El error fue: "${step.errorText}".` : '';

    inputValue =
      `La llamada a ${step.toolName} falló.${detail} ` +
      'Reintentá SOLO esa acción, corrigiendo lo que causó el error. ' +
      'No rehagas nada de lo que ya quedó completo en este turno.';

    void handleSend();
  }

  async function handleImplementPlan(editedPlan: unknown) {
    if (!puedeMandarAhora()) return;
    if (!courseId) return;

    const conversationId = await ensureActiveConversation(courseId);
    if (!conversationId) return;

    // A freshly approved plan is a new build: clear any brake left over from the
    // previous one so it can run to completion on its own.
    resetAutoContinue();
    inputValue = '';
    avisoDeCorte = false;

    // Una aprobación anterior que falló (es el último mensaje: no tuvo respuesta)
    // se reemplaza por ésta, que puede traer ediciones. Apilarlas dejaba en la
    // conversación una aprobación sin responder por cada intento.
    const ultimo = chat.messages.at(-1) as AiAssistantMessage | undefined;

    if (ultimo && mensajeDeControl(ultimo) === 'aprobacion') {
      chat.messages = chat.messages.slice(0, -1);
    }

    // El texto es del contrato con la API, en castellano: el servidor reconoce
    // la aprobación por `metadata.plan`, y el subagente de construcción lee el
    // texto como su orden. La pantalla lo dibuja como una ficha, no como algo
    // que la docente escribió.
    chat.sendMessage({
      text: TEXTO_DE_APROBACION,
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
    if (!puedeMandarAhora() || !courseId) return;

    const conversationId = await ensureActiveConversation(courseId);
    if (!conversationId) return;

    chat.sendMessage({
      text: texto,
      metadata: { plan: { action: 'request_plan_changes' } }
    });
  }

  function handleResume() {
    if (!puedeMandarAhora()) return;

    // Pressing "Continue" is the teacher choosing to build: it turns the
    // automatic continuation on for the rounds that follow.
    freno = { ...freno, habilitada: true };
    // Como texto armado y no por el compositor: lo que la docente tenía a medio
    // escribir (y sus imágenes) no se pisa ni viaja con la continuación.
    void handleSend(TEXTO_DE_CONTINUACION);
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
    if (isStreaming || esperandoRonda) return;

    const messages = chat.messages as AiAssistantMessage[];
    const decision = decidirContinuacion(freno, messages[messages.length - 1]);

    if (decision.tipo === 'esperar') return;

    if (decision.tipo === 'frenar') {
      freno = { ...freno, habilitada: false };
      return;
    }

    freno = decision.freno;
    void handleSend(TEXTO_DE_CONTINUACION);
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
   *
   * Una aprobación cuenta si tuvo respuesta o si está en vuelo. Una que falló
   * —medido: un vencimiento antes de que el servidor contestara— dejaba el plan
   * «Aprobado» sin construir nada y sin el botón de aprobar, también después de
   * recargar. Ver `aprobacionVigente`.
   */
  const planAprobado = $derived.by((): CoursePlan | null => {
    if (!planVigente) return null;

    const mensajes = chat.messages as AiAssistantMessage[];
    const desde = mensajes.findIndex((mensaje) => mensaje.id === planVigente.messageId);
    const aprobacion = aprobacionVigente(mensajes, desde, isStreaming);

    if (!aprobacion) return null;

    const aprobado = aprobacion.payload as CoursePlan | undefined;

    return aprobado && Array.isArray(aprobado.sections) ? aprobado : planVigente.plan;
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
      // Con una ronda viva en el servidor tampoco se aprueba ni se piden
      // cambios: el pedido volvería con 409.
      ocupado: isStreaming || esperandoRonda,
      progreso: ultimoProgreso
    });
  });

  // Para la pantalla de Fuentes: una fuente nueva con un plan ya armado queda
  // afuera de la construcción, y ahí se avisa. Ver `plan-del-curso.svelte.ts`.
  $effect(() => {
    planDelCurso.sincronizar(courseId ?? null, estadoDelPlan(chat.messages as AiAssistantMessage[], isStreaming));
  });

  /**
   * Hay un turno que falló y se puede volver a pedir: la ronda terminó con error
   * o se cortó, no hay otra ronda en curso, y no fue un 409 (ahí la
   * conversación tiene otra ronda viva y el panel la espera).
   */
  const puedeReintentar = $derived(
    !isStreaming &&
      !esperandoRonda &&
      (chat.status === 'error' || avisoDeCorte) &&
      !esRondaEnCurso(chat.error) &&
      ultimoTurnoDelDocente(chat.messages as AiAssistantMessage[]) !== null
  );

  $effect(() => {
    setReintentoDisponible(puedeReintentar);
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
    if (!puedeMandarAhora()) return;

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
          borradorPideRehacerPlan = !!draft.rehacerPlan;
        })
      );

      return;
    }

    void tick().then(() => {
      const existing = inputValue.trimEnd();

      inputValue = existing ? `${draft.text}\n\n${existing}` : `${draft.text}\n\n`;
      borradorPideRehacerPlan = !!draft.rehacerPlan;
    });
  });

  // Si la docente borra el pedido de «rehacé el plan», lo que escriba después es
  // otra cosa: deja de viajar como pedido de cambios.
  $effect(() => {
    if (!inputValue.trim()) borradorPideRehacerPlan = false;
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
    resumeState={esperandoRonda ? null : planExecutionState}
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
      streamCut={avisoDeCorte}
      waitingForRound={esperandoRonda}
      stopping={deteniendo}
      canRetry={puedeReintentar}
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
