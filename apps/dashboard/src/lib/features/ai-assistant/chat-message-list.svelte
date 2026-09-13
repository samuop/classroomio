<script lang="ts">
  import type { MentionRef, MentionTarget } from '$features/ai-assistant/utils/mentions';
  import SparklesIcon from '@lucide/svelte/icons/sparkles';
  import ArrowUpRightIcon from '@lucide/svelte/icons/arrow-up-right';
  import { Button } from '@cio/ui/base/button';
  import MessageBubble from '$features/ai-assistant/message-bubble.svelte';
  import AgentWork from '$features/ai-assistant/agent-work.svelte';
  import { t } from '$lib/utils/functions/translations';
  import type { NombrarPorId, ProgressStep } from '$features/ai-assistant/utils/tool-labels';
  import type { PlanMostrado } from '$features/ai-assistant/utils/plan-screen.svelte';
  import type { AiAssistantMessage, AiAssistantMessageMetadata } from '$features/ai-assistant/utils/types';
  import type { CourseTemplateId, TemplateFormField } from '@cio/ai-assistant';

  interface QuickActionOption {
    key: string;
    prompt: string;
  }

  /** Cuándo ofrecer «Continuar»: la ronda se cortó con trabajo pendiente. */
  interface ResumeState {
    isStopped: boolean;
    /** Set when the server reported the plan is still incomplete → drives the notice copy. */
    pendingSummary?: { pendingCount: number; emptyCount: number };
  }

  interface Props {
    messages: AiAssistantMessage[];
    isStreaming: boolean;
    isStudent: boolean;
    courseId: string;
    resumeState: ResumeState | null;
    quickActions: QuickActionOption[];
    onQuickAction: (action: string) => void;
    latestPlanId: string | null;
    onOpenPlan: (plan: PlanMostrado) => void;
    onOpenLatestPlan: () => void;
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
    onResume: () => void;
    onMentionClick: (route: string, mention?: MentionRef) => void;
    mentionTargets?: MentionTarget[];
    nombrar?: NombrarPorId;
    onUseImageInLesson?: (url: string) => void;
    esFuenteDelCurso?: (documentId: string) => boolean;
  }

  let {
    messages,
    isStreaming,
    isStudent,
    courseId,
    resumeState,
    quickActions,
    onQuickAction,
    latestPlanId,
    onOpenPlan,
    onOpenLatestPlan,
    onSubmitTemplateAnswers,
    onSkipTemplateForm,
    onSubmitDiscoveryAnswers,
    onSkipDiscoveryForm,
    onRetryStep,
    onResume,
    onMentionClick,
    mentionTargets,
    nombrar,
    onUseImageInLesson,
    esFuenteDelCurso
  }: Props = $props();

  let messagesContainer: HTMLDivElement | undefined = $state();
  let lastMessageCount = $state(0);
  let lastStreamingSig = $state('');
  // True when the user is at (or very near) the bottom. Streaming auto-scroll is gated on this
  // so scrolling up doesn't get clobbered by the next token.
  let isPinnedToBottom = $state(true);

  const SCROLL_PIN_THRESHOLD = 60;

  function handleScroll() {
    if (!messagesContainer) return;

    const distanceFromBottom =
      messagesContainer.scrollHeight - messagesContainer.scrollTop - messagesContainer.clientHeight;
    isPinnedToBottom = distanceFromBottom <= SCROLL_PIN_THRESHOLD;
  }

  const isEmpty = $derived(messages.length === 0);

  /**
   * Cuándo empezó la ronda en curso, para el contador de la línea viva. Se toma
   * en el flanco: el momento en que el chat pasa a transmitir.
   */
  let startedAt = $state<number | null>(null);
  let wasStreaming = false;

  $effect(() => {
    const streamingNow = isStreaming;

    if (streamingNow && !wasStreaming) startedAt = Date.now();

    wasStreaming = streamingNow;
  });

  /** El docente ya mandó y todavía no llegó ni una parte de la respuesta. */
  const waitingForReply = $derived(isStreaming && messages[messages.length - 1]?.role !== 'assistant');

  // Grows as the latest message streams in — text, reasoning and tool calls alike —
  // so the view stays pinned to what the agent is doing right now.
  const streamingContentSig = $derived.by(() => {
    const last = messages[messages.length - 1];

    if (!last || last.role !== 'assistant') return '';

    let chars = 0;

    for (const part of last.parts ?? []) {
      const text = (part as { text?: string }).text;
      if (typeof text === 'string') chars += text.length;
    }

    return `${last.parts?.length ?? 0}:${chars}`;
  });

  function scrollToBottom(behavior: ScrollBehavior = 'smooth') {
    requestAnimationFrame(() => {
      messagesContainer?.scrollTo({ top: messagesContainer.scrollHeight, behavior });
    });
  }

  $effect(() => {
    if (!messagesContainer || messages.length === 0) return;

    if (messages.length === lastMessageCount) return;

    lastMessageCount = messages.length;
    // A new message (typically the user's) — force scroll and re-pin.
    isPinnedToBottom = true;
    scrollToBottom();
  });

  $effect(() => {
    if (!messagesContainer) return;

    if (streamingContentSig === lastStreamingSig) return;

    lastStreamingSig = streamingContentSig;

    if (!isPinnedToBottom) return;

    // Use 'auto' during streaming — smooth scrolls queue up per token and lag behind the cursor.
    scrollToBottom('auto');
  });
</script>

<div class="flex-1 overflow-y-auto overscroll-contain px-5 py-5" bind:this={messagesContainer} onscroll={handleScroll}>
  {#if isEmpty}
    <div class="flex min-h-full flex-col justify-end gap-5 pb-2 sm:justify-center">
      <div class="flex flex-col gap-2 px-0.5">
        <span class="flex size-9 items-center justify-center rounded-xl bg-(--primary)/10 text-(--primary)">
          <SparklesIcon size={18} />
        </span>
        <h2 class="text-lg font-semibold text-balance">
          {$t(isStudent ? 'ai_assistant.student_greeting' : 'ai_assistant.greeting')}
        </h2>
        <p class="ui:text-muted-foreground text-sm text-pretty">
          {$t(isStudent ? 'ai_assistant.student_empty_state' : 'ai_assistant.empty_state')}
        </p>
      </div>

      <div class="flex flex-col gap-1.5">
        {#each quickActions as option (option.key)}
          <button
            type="button"
            onclick={() => onQuickAction(option.prompt)}
            class="group/sugerencia flex w-full cursor-pointer items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left text-sm transition-colors hover:bg-(--muted)"
          >
            <span class="min-w-0">{$t(option.key)}</span>
            <ArrowUpRightIcon
              size={14}
              class="ui:text-muted-foreground shrink-0 transition-transform group-hover/sugerencia:translate-x-0.5 group-hover/sugerencia:-translate-y-0.5"
            />
          </button>
        {/each}
      </div>
    </div>
  {:else}
    <div class="flex flex-col gap-6">
      {#each messages as message, messageIndex (message.id)}
        {@const compaction = (message.metadata as AiAssistantMessageMetadata | undefined)?.compaction}
        {@const isLast = messageIndex === messages.length - 1}

        {#if compaction}
          <p class="ui:text-muted-foreground px-1 text-center text-[11px] leading-snug">
            {$t('ai_assistant.context_compacted_badge', { count: compaction.originalMessageCount })}
          </p>
        {/if}

        <MessageBubble
          {message}
          {messages}
          {courseId}
          {isStreaming}
          {isLast}
          {startedAt}
          {nombrar}
          {latestPlanId}
          {onOpenPlan}
          {onOpenLatestPlan}
          {onSubmitTemplateAnswers}
          {onSkipTemplateForm}
          {onSubmitDiscoveryAnswers}
          {onSkipDiscoveryForm}
          onRetryStep={isStudent ? undefined : onRetryStep}
          {onMentionClick}
          {mentionTargets}
          {onUseImageInLesson}
          {esFuenteDelCurso}
        />
      {/each}

      {#if waitingForReply}
        <AgentWork message={null} isLive {startedAt} {courseId} onNavigate={onMentionClick} {nombrar} />
      {/if}

      {#if resumeState?.isStopped && !isStudent && !isStreaming}
        <div class="flex flex-col gap-2 rounded-xl border px-3 py-2.5">
          <p class="ui:text-muted-foreground text-xs">
            {#if resumeState.pendingSummary}
              {$t('ai_assistant.plan_incomplete_notice', {
                pending: resumeState.pendingSummary.pendingCount,
                empty: resumeState.pendingSummary.emptyCount
              })}
            {:else}
              {$t('ai_assistant.stopped_content_kept')}
            {/if}
          </p>
          <Button size="sm" variant="default" onclick={onResume} class="w-full">
            {$t('ai_assistant.resume')}
          </Button>
        </div>
      {/if}
    </div>
  {/if}
</div>
