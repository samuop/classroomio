<script lang="ts">
  import AlertCircleIcon from '@lucide/svelte/icons/alert-circle';
  import CheckIcon from '@lucide/svelte/icons/check';
  import CircleIcon from '@lucide/svelte/icons/circle';
  import CopyIcon from '@lucide/svelte/icons/copy';
  import FileTextIcon from '@lucide/svelte/icons/file-text';
  import ListChecksIcon from '@lucide/svelte/icons/list-checks';
  import LoaderIcon from '@lucide/svelte/icons/loader';
  import { renderMarkdown } from '$features/ai-assistant/utils/markdown';
  import {
    getMentionRoute,
    renderMentions,
    type MentionRef,
    type MentionTarget
  } from '$features/ai-assistant/utils/mentions';
  import { getWriterNotes } from '$features/ai-assistant/utils/writer-notes';
  import AgentWork from '$features/ai-assistant/agent-work.svelte';
  import PlanCard from '$features/ai-assistant/plan-card.svelte';
  import ChatImageViewer from '$features/ai-assistant/chat-image-viewer.svelte';
  import TemplateFormCard from '$features/ai-assistant/template-form-card.svelte';
  import DiscoveryFormCard from '$features/ai-assistant/discovery-form-card.svelte';
  import { isTemplateFormResolved } from '$features/ai-assistant/utils/template-form-resolved';
  import { isDiscoveryFormResolved } from '$features/ai-assistant/utils/discovery-form-resolved';
  import { mergeTemplateFieldsWithRegistry } from '$features/ai-assistant/utils/template-fields';
  import ToolLine from '$features/ai-assistant/utils/tool-line.svelte';
  import {
    getCompletedToolLine,
    getPendingToolI18nKey,
    getPendingToolI18nVars,
    getPendingToolLine,
    type NombrarPorId,
    type ProgressStep
  } from '$features/ai-assistant/utils/tool-labels';
  import { idDelPlan } from '$features/ai-assistant/utils/plan-summary';
  import type { CoursePlan } from '$features/ai-assistant/utils/course-plan';
  import type { PlanMostrado } from '$features/ai-assistant/utils/plan-screen.svelte';
  import { snackbar } from '$features/ui/snackbar/store';
  import { t } from '$lib/utils/functions/translations';
  import {
    getAgentToolName,
    getAgentToolInput,
    getAgentToolResult,
    getAgentToolStatus,
    isAgentToolPart
  } from '$features/ai-assistant/utils/tool-parts';
  import type { AiAssistantMessage, AiAssistantMessageMetadata } from '$features/ai-assistant/utils/types';
  import type { CourseTemplateId, TemplateFormField } from '@cio/ai-assistant';

  interface Props {
    message: AiAssistantMessage;
    messages: AiAssistantMessage[];
    courseId: string;
    isStreaming: boolean;
    isLast?: boolean;
    /** Cuándo empezó la ronda en curso, para el contador de la línea viva. */
    startedAt?: number | null;
    nombrar?: NombrarPorId;
    /** Id de la versión más nueva del plan en la conversación. */
    latestPlanId: string | null;
    onOpenPlan: (plan: PlanMostrado) => void;
    /** Abre el plan vigente, desde la fila de avance de la construcción. */
    onOpenLatestPlan?: () => void;
    onSubmitTemplateAnswers: (payload: {
      templateId: CourseTemplateId;
      answers: Record<string, string>;
      fields: TemplateFormField[];
    }) => void;
    onSkipTemplateForm: (payload: { templateId: CourseTemplateId }) => void;
    onSubmitDiscoveryAnswers: (payload: {
      formId: string;
      answers: Record<string, string>;
      fields: TemplateFormField[];
    }) => void;
    onSkipDiscoveryForm: (payload: { formId: string }) => void;
    onRetryStep?: (step: ProgressStep) => void;
    /**
     * Gets what the agent wrote along with the route, so the click can check it
     * against a fresher course than the one this render saw.
     */
    onMentionClick: (route: string, mention?: MentionRef) => void;
    /** The course items the agent's links are checked against. See `resolveMention`. */
    mentionTargets?: MentionTarget[];
    /** Pedirle al asistente que ponga una imagen adjunta en la lección abierta. */
    onUseImageInLesson?: (url: string) => void;
    /**
     * Si el documento adjunto es una fuente del curso. El chat adjunta sola la
     * última fuente en cada mensaje; mostrarla como si el docente la hubiera
     * elegido repetía el mismo nombre debajo de cada pregunta.
     */
    esFuenteDelCurso?: (documentId: string) => boolean;
  }

  let {
    message,
    messages,
    courseId,
    isStreaming,
    isLast = false,
    startedAt = null,
    nombrar,
    latestPlanId,
    onOpenPlan,
    onOpenLatestPlan,
    onSubmitTemplateAnswers,
    onSkipTemplateForm,
    onSubmitDiscoveryAnswers,
    onSkipDiscoveryForm,
    onRetryStep,
    onMentionClick,
    mentionTargets,
    onUseImageInLesson,
    esFuenteDelCurso
  }: Props = $props();

  function localizePendingTool(toolName: string): string {
    const vars = getPendingToolI18nVars(toolName);
    const key = getPendingToolI18nKey(toolName);

    return t.get(key, vars ?? {});
  }

  function handleBubbleClick(event: MouseEvent) {
    const target = event.target as HTMLElement;
    const mentionLink = target.closest('[data-mention-route]') as HTMLElement | null;

    if (mentionLink) {
      event.preventDefault();
      const route = mentionLink.dataset.mentionRoute;
      const { mentionType, mentionId, mentionTitle } = mentionLink.dataset;
      const mention =
        mentionType === 'lesson' || mentionType === 'exercise' || mentionType === 'section'
          ? { type: mentionType, id: mentionId ?? '', title: mentionTitle ?? '' }
          : undefined;

      if (route) {
        onMentionClick(route, mention);
      }
    }
  }

  const messageAttachment = $derived((message.metadata as AiAssistantMessageMetadata | undefined)?.attachment);
  const mostrarAdjunto = $derived(!!messageAttachment && !esFuenteDelCurso?.(messageAttachment.documentId));

  // What the lesson writer could not cover, read from the tool results rather
  // than left to the agent to repeat. See `getWriterNotes`.
  const writerNotes = $derived(message.role === 'assistant' ? getWriterNotes(message.parts ?? []) : []);

  /** Tool parts rendered in a second pass so narrative text always appears above them (stream order often emits tools first). */
  function isDeferredPlanPart(part: Record<string, unknown>) {
    if (!isAgentToolPart(part)) {
      return false;
    }

    const name = getAgentToolName(part);

    return name === 'generate_course_plan' || name === 'ask_template_questions' || name === 'ask_discovery_questions';
  }

  function truncateErrorText(errorText: string): string {
    // Show just the summary before the raw Value JSON dump
    const valueIndex = errorText.indexOf(' Value: ');
    if (valueIndex !== -1) {
      return errorText.slice(0, valueIndex);
    }

    return errorText.length > 120 ? errorText.slice(0, 120) + '…' : errorText;
  }

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text);
  }

  function getPartErrorText(part: unknown): string | undefined {
    return (part as { errorText?: string }).errorText;
  }

  /**
   * Split the assistant's prose into "narration while working" and "the reply".
   *
   * Everything the model wrote BEFORE its last tool call was said mid-task —
   * "Both items are now in place. Now let me verify the final state…" — and used
   * to be hoisted to the top of the bubble, so a build turn read as a wall of the
   * model thinking out loud. What comes after the last tool call is the answer.
   *
   * Structural, not keyword-based: MiniMax emits this as plain `text` parts
   * (zero `reasoning` parts exist in the stored history), sometimes in English
   * mid-Spanish conversation, so no phrase list would hold. Real `reasoning`
   * parts —Gemini's thought summaries— are folded in too.
   */
  const partsSplit = $derived.by(() => {
    const parts = (message.parts ?? []) as Array<Record<string, unknown>>;
    let lastToolIndex = -1;
    let lastTextIndex = -1;

    parts.forEach((part, index) => {
      // Self-rendered tools (the plan card, the question forms) are the
      // deliverable, not work in progress. Counting them here would file the
      // model's intro — "Here's the plan I put together:" — as narration and
      // hide it above its own card.
      if (isAgentToolPart(part) && !isDeferredPlanPart(part)) lastToolIndex = index;
      if (part.type === 'text') lastTextIndex = index;
    });

    /**
     * Where the working-out stops and the answer starts.
     *
     * The last tool call when there is one. When there isn't, falling back to
     * the last text part keeps a turn that never called a tool from rendering
     * its entire chain-of-thought as the reply. A single text part stays whole:
     * with nothing to split on, guessing would be worse than showing it.
     */
    const narrationBoundary = lastToolIndex >= 0 ? lastToolIndex : lastTextIndex;

    const thinking: string[] = [];
    const reply: Array<Record<string, unknown>> = [];

    parts.forEach((part, index) => {
      const type = typeof part.type === 'string' ? part.type : '';

      if (type === 'reasoning' && typeof part.text === 'string') {
        thinking.push(part.text);
        return;
      }

      if (type !== 'text') return;

      if (index < narrationBoundary) thinking.push(part.text as string);
      else reply.push(part);
    });

    // A round cut short by the step limit can end on narration with no reply at
    // all. Promote the last block so the message is never blank.
    if (reply.length === 0 && thinking.length > 0 && lastTextIndex >= 0) {
      const promoted = thinking.pop() as string;
      return { thinking, reply: [{ type: 'text', text: promoted }] };
    }

    return { thinking, reply };
  });

  const thinkingBlocks = $derived(
    message.role === 'assistant' ? partsSplit.thinking.filter((block) => block?.trim()) : []
  );
  const inlineParts = $derived(
    message.role === 'assistant'
      ? partsSplit.reply
      : (message.parts ?? []).filter((part) => {
          const record = part as { type?: string; text?: string };
          return record.type === 'text' && !!record.text?.trim();
        })
  );

  /** Plan and form cards, with their position in `parts` so a plan version keeps a stable id. */
  const deferredPlanParts = $derived(
    (message.parts ?? []).flatMap((part, index) =>
      isDeferredPlanPart(part as Record<string, unknown>) ? [{ part, index }] : []
    )
  );

  // Build progress measured by the server (plan reconciled against the live
  // course once the round's writes landed), carried on the finish metadata.
  const planProgress = $derived(message.role === 'assistant' ? message.metadata?.planProgress : undefined);
  const showPlanProgress = $derived(!!planProgress && planProgress.total > 0);
  const progressPercent = $derived(
    planProgress && planProgress.total > 0 ? Math.round((planProgress.completed / planProgress.total) * 100) : 0
  );

  /**
   * Lo que el servidor vio cambiar, debajo de lo que el asistente cuenta.
   *
   * Se lee a la defensiva —llega de la metadata, que es clave abierta— y sólo
   * se dibuja si hay algo: una ronda de preguntas y respuestas no cambia nada.
   */
  const roundChanges = $derived(
    message.role === 'assistant' && Array.isArray(message.metadata?.roundChanges)
      ? message.metadata.roundChanges.filter((linea): linea is string => typeof linea === 'string' && !!linea.trim())
      : []
  );

  const isStreamingThisMessage = $derived(isStreaming && isLast && message.role === 'assistant');
  const hasToolParts = $derived((message.parts ?? []).some((part) => isAgentToolPart(part)));

  const hasAssistantContent = $derived(
    isStreamingThisMessage ||
      inlineParts.length > 0 ||
      deferredPlanParts.length > 0 ||
      thinkingBlocks.length > 0 ||
      hasToolParts ||
      writerNotes.length > 0 ||
      roundChanges.length > 0 ||
      showPlanProgress
  );

  /**
   * Markdown is re-parsed and its entire subtree replaced on every token. So
   * while THIS message is streaming, sample the parts on a fixed cadence instead
   * of rendering every token: the same text arrives at the same speed, it just
   * stops re-laying out between frames. Once streaming ends we render
   * `inlineParts` directly, so the final content is never a stale sample.
   */
  const STREAM_RENDER_INTERVAL_MS = 90;

  let sampledParts = $state<typeof inlineParts>([]);
  let lastSampleAt = 0;

  $effect(() => {
    const parts = inlineParts;

    if (!isStreamingThisMessage) return;

    const waitMs = STREAM_RENDER_INTERVAL_MS - (Date.now() - lastSampleAt);

    // First token of a turn commits immediately.
    if (waitMs <= 0) {
      lastSampleAt = Date.now();
      sampledParts = parts;
      return;
    }

    // Trailing commit: without it the last tokens before a pause would wait for
    // a token that never comes.
    const timer = setTimeout(() => {
      lastSampleAt = Date.now();
      sampledParts = parts;
    }, waitMs);

    return () => clearTimeout(timer);
  });

  const partsToRender = $derived(isStreamingThisMessage ? sampledParts : inlineParts);

  // A plan is "already implemented" once a later user message requested its
  // implementation.
  const planAlreadyImplemented = $derived.by(() => {
    const selfIndex = messages.indexOf(message);
    if (selfIndex < 0) return false;

    for (let index = selfIndex + 1; index < messages.length; index += 1) {
      const meta = messages[index]?.metadata as AiAssistantMessageMetadata | undefined;
      if (messages[index]?.role === 'user' && meta?.plan?.action === 'implement_course_plan') {
        return true;
      }
    }

    return false;
  });

  interface ImagenAdjunta {
    url: string;
    nombre: string;
  }

  const imagenes = $derived.by((): ImagenAdjunta[] => {
    if (message.role !== 'user') return [];

    return (message.parts ?? []).flatMap((part) => {
      const archivo = part as { type?: string; mediaType?: string; url?: string; filename?: string };

      return archivo.type === 'file' && archivo.mediaType?.startsWith('image/') && archivo.url
        ? [{ url: archivo.url, nombre: archivo.filename || 'imagen' }]
        : [];
    });
  });

  let imagenEnGrande = $state<ImagenAdjunta | null>(null);
  let visorAbierto = $state(false);

  function verImagen(imagen: ImagenAdjunta) {
    imagenEnGrande = imagen;
    visorAbierto = true;
  }

  const textoDeLaRespuesta = $derived(
    message.role === 'assistant'
      ? inlineParts
          .map((part) => (typeof part.text === 'string' ? part.text : ''))
          .join('\n\n')
          .trim()
      : ''
  );

  async function copiarRespuesta() {
    try {
      await navigator.clipboard.writeText(textoDeLaRespuesta);
      snackbar.success(t.get('ai_assistant.activity.copied'));
    } catch {
      // Sin permiso de portapapeles no hay nada que avisar.
    }
  }
</script>

<div
  data-role={message.role}
  class="group/mensaje flex flex-col gap-2 {message.role === 'user' ? 'items-end' : 'items-stretch'}"
>
  {#if message.role === 'user'}
    {#if imagenes.length > 0}
      <div class="flex max-w-[85%] flex-wrap justify-end gap-1.5">
        {#each imagenes as imagen, indice (`${imagen.url}-${indice}`)}
          <button
            type="button"
            class="block overflow-hidden rounded-xl border transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-(--ring) focus-visible:outline-none"
            onclick={() => verImagen(imagen)}
            title={imagen.nombre}
          >
            <img
              src={imagen.url}
              alt={$t('ai_assistant.attachments.image_alt', { name: imagen.nombre })}
              loading="lazy"
              class="block object-cover {imagenes.length === 1 ? 'max-h-48 max-w-60' : 'size-24'}"
            />
          </button>
        {/each}
      </div>
    {/if}

    {#if mostrarAdjunto && messageAttachment}
      <div class="ui:text-muted-foreground flex max-w-[85%] items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs">
        <FileTextIcon size={12} class="shrink-0" />
        <span class="min-w-0 truncate">{messageAttachment.name}</span>
      </div>
    {/if}

    {#if inlineParts.length > 0}
      <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
      <div class="ui:bg-muted max-w-[85%] rounded-2xl rounded-br-md px-3.5 py-2 text-sm" onclick={handleBubbleClick}>
        {#each inlineParts as part, partIndex (partIndex)}
          <div class="ai-chat-prose prose prose-sm dark:prose-invert max-w-none break-words">
            <!-- eslint-disable-next-line svelte/no-at-html-tags -->
            {@html renderMentions(renderMarkdown(part.text as string), courseId, mentionTargets)}
          </div>
        {/each}
      </div>
    {/if}
  {:else if hasAssistantContent}
    <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
    <div class="flex w-full min-w-0 flex-col gap-3 text-sm" onclick={handleBubbleClick}>
      <AgentWork
        {message}
        isLive={isStreamingThisMessage}
        startedAt={isLast ? startedAt : null}
        thoughts={thinkingBlocks}
        {courseId}
        onNavigate={onMentionClick}
        {nombrar}
        {onRetryStep}
      />

      {#each partsToRender as part, partIndex (partIndex)}
        {#if part.type === 'text'}
          <div class="ai-chat-prose prose prose-sm dark:prose-invert max-w-none break-words">
            <!-- eslint-disable-next-line svelte/no-at-html-tags -->
            {@html renderMentions(renderMarkdown(part.text as string), courseId, mentionTargets)}
          </div>
        {/if}
      {/each}

      {#if writerNotes.length > 0}
        <div class="rounded-xl border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs" data-writer-notes>
          <p class="mb-1 font-medium">{$t('ai_assistant.writer_notes_title')}</p>
          <ul class="space-y-1">
            {#each writerNotes as item, noteIndex (noteIndex)}
              <li>
                {#if item.lessonId && item.title}
                  <button
                    type="button"
                    class="mention-link font-medium"
                    onclick={() => onMentionClick(getMentionRoute(courseId, 'lesson', item.lessonId))}
                  >
                    {item.title}</button
                  >:
                {/if}
                <span class="ui:text-muted-foreground">{item.note}</span>
              </li>
            {/each}
          </ul>
        </div>
      {/if}

      {#each deferredPlanParts as { part, index } (index)}
        {@const toolName = getAgentToolName(part)}
        {@const toolResult = getAgentToolResult(part)}
        {@const toolStatus = getAgentToolStatus(part)}
        {@const errorText = getPartErrorText(part)}
        {#if toolName === 'generate_course_plan' && toolStatus === 'completed'}
          {@const planId = idDelPlan(message.id, part, index)}
          <!--
            Aprobar marca como aprobada sólo la versión vigente: con la marca por
            mensaje, cualquier aprobación posterior encendía «Aprobado» también en
            las versiones que el docente descartó al pedir cambios.
          -->
          <PlanCard
            plan={toolResult as CoursePlan}
            isLatest={planId === latestPlanId}
            implemented={planAlreadyImplemented && planId === latestPlanId}
            onOpen={() => onOpenPlan({ id: planId, plan: toolResult as CoursePlan })}
          />
        {:else if toolName === 'ask_template_questions' && (toolStatus === 'completed' || toolStatus === 'in_progress')}
          {@const merged = (toolResult ?? getAgentToolInput(part)) as
            | { templateId?: CourseTemplateId; fields?: TemplateFormField[] }
            | undefined}
          {#if merged?.templateId}
            {@const canonicalFields = mergeTemplateFieldsWithRegistry(merged.templateId, merged.fields)}
            {#if canonicalFields.length > 0}
              <TemplateFormCard
                templateId={merged.templateId}
                fields={canonicalFields}
                allMessages={messages}
                submitted={isTemplateFormResolved(messages, merged.templateId)}
                disableFormInputs={toolStatus === 'in_progress'}
                onSubmit={onSubmitTemplateAnswers}
                onSkip={onSkipTemplateForm}
              />
            {/if}
          {/if}
        {:else if toolName === 'ask_discovery_questions' && (toolStatus === 'completed' || toolStatus === 'in_progress')}
          {@const data = (toolResult ?? getAgentToolInput(part)) as
            | { formId?: string; title?: string; intro?: string; fields?: TemplateFormField[] }
            | undefined}
          {#if data?.formId && data?.fields?.length}
            <DiscoveryFormCard
              formId={data.formId}
              fields={data.fields}
              title={data.title}
              intro={data.intro}
              allMessages={messages}
              submitted={isDiscoveryFormResolved(messages, data.formId)}
              disableFormInputs={toolStatus === 'in_progress'}
              onSubmit={onSubmitDiscoveryAnswers}
              onSkip={onSkipDiscoveryForm}
            />
          {/if}
        {:else if toolStatus === 'failed' && toolName}
          <div class="flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs">
            <AlertCircleIcon size={12} class="shrink-0 text-red-500" />
            <span class="min-w-0 flex-1 truncate text-red-600 dark:text-red-400">
              {#if errorText}
                {truncateErrorText(errorText)}
              {:else}
                {$t('ai_assistant.run_failed_after', { action: localizePendingTool(toolName) })}
              {/if}
            </span>
            {#if errorText}
              <button
                type="button"
                class="ui:text-muted-foreground ml-1 shrink-0 cursor-pointer hover:text-red-500"
                title={$t('ai_assistant.copy_full_error')}
                onclick={() => copyToClipboard(errorText)}
              >
                <CopyIcon size={11} />
              </button>
            {/if}
          </div>
        {:else if toolStatus === 'completed' && toolName && toolName !== 'generate_course_plan'}
          <div class="flex items-center gap-2 text-xs">
            <CheckIcon size={12} class="ui:text-primary shrink-0" />
            <ToolLine line={getCompletedToolLine(toolName, toolResult)} {courseId} onNavigate={onMentionClick} />
          </div>
        {:else if toolStatus === 'pending' && toolName}
          <div class="ui:text-muted-foreground flex items-center gap-2 text-xs">
            <CircleIcon size={12} class="shrink-0" />
            <ToolLine line={getPendingToolLine(toolName)} {courseId} onNavigate={onMentionClick} />
          </div>
        {:else if toolStatus === 'in_progress' && toolName === 'generate_course_plan' && !isStreamingThisMessage}
          <div class="ui:text-muted-foreground flex items-center gap-2 text-xs">
            <LoaderIcon size={12} class="shrink-0 animate-spin" />
            <ToolLine line={getPendingToolLine(toolName)} {courseId} onNavigate={onMentionClick} />
          </div>
        {/if}
      {/each}

      {#if roundChanges.length > 0}
        <div class="rounded-xl border px-3 py-2">
          <p class="ui:text-muted-foreground text-xs font-medium">
            {$t('course.navItem.lessons.build_report.round_changes')}
          </p>
          <ul class="mt-1 space-y-0.5 text-xs">
            {#each roundChanges as cambio (cambio)}
              <li>{cambio}</li>
            {/each}
          </ul>
        </div>
      {/if}

      {#if showPlanProgress && planProgress}
        <button
          type="button"
          class="flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors hover:bg-(--muted) disabled:pointer-events-none"
          onclick={() => onOpenLatestPlan?.()}
          disabled={!onOpenLatestPlan || !latestPlanId}
        >
          <ListChecksIcon size={16} class="ui:text-primary shrink-0" />
          <span class="flex min-w-0 flex-1 flex-col gap-1.5">
            <span class="flex items-center justify-between gap-2 text-xs">
              <span class="font-medium">{$t('ai_assistant.todo_checklist.title')}</span>
              <span class="ui:text-muted-foreground tabular-nums">
                {$t('ai_assistant.plan_screen.progress', {
                  completed: planProgress.completed,
                  total: planProgress.total
                })}
              </span>
            </span>
            <span class="block h-1 w-full overflow-hidden rounded-full bg-(--muted)">
              <span class="block h-full rounded-full bg-(--primary) transition-all duration-300" style="width: {progressPercent}%"
              ></span>
            </span>
          </span>
          {#if onOpenLatestPlan && latestPlanId}
            <span class="ui:text-primary shrink-0 text-xs font-medium">{$t('ai_assistant.plan_screen.open')}</span>
          {/if}
        </button>
      {/if}

      {#if !isStreamingThisMessage && textoDeLaRespuesta}
        <div class="flex opacity-60 transition-opacity group-hover/mensaje:opacity-100 focus-within:opacity-100">
          <button
            type="button"
            class="ui:text-muted-foreground inline-flex size-7 items-center justify-center rounded-md transition-colors hover:bg-(--muted) hover:text-(--foreground)"
            title={$t('ai_assistant.activity.copy_reply')}
            aria-label={$t('ai_assistant.activity.copy_reply')}
            onclick={copiarRespuesta}
          >
            <CopyIcon size={14} />
          </button>
        </div>
      {/if}
    </div>
  {/if}
</div>

{#if imagenEnGrande}
  <ChatImageViewer
    bind:open={visorAbierto}
    url={imagenEnGrande.url}
    name={imagenEnGrande.nombre}
    onUseInLesson={onUseImageInLesson}
  />
{/if}

<style>
  /* Reset global `apps/dashboard/src/app.css` `.prose p { mb-4 }` for chat bubbles */
  :global(.ai-chat-prose.prose p) {
    margin-bottom: 0;
  }

  /* Sin el margen global los párrafos quedaban pegados: un respiro entre bloques. */
  :global(.ai-chat-prose.prose > * + *) {
    margin-top: 0.6em;
  }

  :global(.mention-link) {
    display: inline;
    cursor: pointer;
    font-weight: 500;
    text-decoration: underline;
    text-decoration-style: dotted;
    text-underline-offset: 2px;
    border-radius: 0.125rem;
    transition: opacity 0.15s;
  }

  :global(.mention-link:hover) {
    opacity: 0.8;
  }
</style>
