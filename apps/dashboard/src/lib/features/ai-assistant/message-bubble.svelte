<script lang="ts">
  import CheckIcon from '@lucide/svelte/icons/check';
  import AlertCircleIcon from '@lucide/svelte/icons/alert-circle';
  import CircleIcon from '@lucide/svelte/icons/circle';
  import LoaderIcon from '@lucide/svelte/icons/loader';
  import CopyIcon from '@lucide/svelte/icons/copy';
  import FileTextIcon from '@lucide/svelte/icons/file-text';
  import { renderMarkdown } from '$features/ai-assistant/utils/markdown';
  import { renderMentions } from '$features/ai-assistant/utils/mentions';
  import PlanView from '$features/ai-assistant/plan-view.svelte';
  import TodoChecklist from '$features/ai-assistant/todo-checklist.svelte';
  import ThinkingBlock from '$features/ai-assistant/thinking-block.svelte';
  import AgentSteps from '$features/ai-assistant/agent-steps.svelte';
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
    getPendingToolLine
  } from '$features/ai-assistant/utils/tool-labels';
  import type { CoursePlan } from '$features/ai-assistant/utils/course-plan';
  import { t } from '$lib/utils/functions/translations';
  import { isPlatformAdmin } from '$lib/utils/store/user';
  import {
    getAgentToolName,
    getAgentToolInput,
    getAgentToolResult,
    getAgentToolStatus,
    getAgentStepsForMessage,
    isAgentToolPart
  } from '$features/ai-assistant/utils/tool-parts';
  import type { AiAssistantMessage, AiAssistantMessageMetadata } from '$features/ai-assistant/utils/types';
  import type { CourseTemplateId, TemplateFormField } from '@cio/ai-assistant';

  interface Props {
    message: AiAssistantMessage;
    messages: AiAssistantMessage[];
    courseId: string;
    onImplementPlan: (editedPlan: unknown) => void;
    onRequestPlanChanges: () => void;
    isStreaming: boolean;
    isLast?: boolean;
    /** True when the live ProgressCard is rendered for this turn (last message) — suppress bubble steps to avoid duplication. */
    liveProgressActive?: boolean;
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
    onMentionClick: (route: string) => void;
  }

  let {
    message,
    messages,
    courseId,
    onImplementPlan,
    onRequestPlanChanges,
    onSubmitTemplateAnswers,
    onSkipTemplateForm,
    onSubmitDiscoveryAnswers,
    onSkipDiscoveryForm,
    onMentionClick,
    isStreaming,
    isLast = false,
    liveProgressActive = false
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

      if (route) {
        onMentionClick(route);
      }
    }
  }

  const messageAttachment = $derived((message.metadata as AiAssistantMessageMetadata | undefined)?.attachment);
  const tokenUsage = $derived((message.metadata as AiAssistantMessageMetadata | undefined)?.tokenUsage);

  /**
   * The headline is the CONTEXT figure — the input size of the last request —
   * because that is the number a teacher can act on: it is what the gauge shows
   * and what decides when to compact.
   *
   * It used to be `totalTokens`, which AI SDK v7 aggregates over every step of
   * the round. A two-step turn re-reads the same 110k prefix twice and reports
   * ~229k, so the footer read "229,418" beside a gauge reading 59% and the two
   * looked contradictory. Both were right; only one answers "how full is it?".
   * `totalTokens` is still the fallback for messages persisted before the field,
   * and stays visible in the tooltip as the billing figure it is.
   */
  const headlineIsContext = $derived(!!tokenUsage?.contextTokens);
  const headlineTokens = $derived(tokenUsage?.contextTokens ?? tokenUsage?.totalTokens ?? 0);

  /**
   * Share of this round's input that the provider served from cache.
   *
   * A build round hitting the 40-step cap legitimately bills millions of tokens.
   * Shown bare that reads as a runaway bill, when in practice ~95% of it is the
   * same cached prefix re-read at a tenth of the price. The percentage is what
   * turns an alarming number into an explicable one.
   */
  const cachedSharePercent = $derived.by(() => {
    const read = tokenUsage?.cacheReadTokens ?? 0;
    const prompt = tokenUsage?.promptTokens ?? 0;
    if (read <= 0 || prompt <= 0) return null;
    return Math.min(100, Math.round((read / prompt) * 100));
  });

  const tokenUsageBreakdown = $derived.by(() => {
    if (!tokenUsage) return undefined;
    const parts = [
      `${$t('ai_assistant.tokens_input')}: ${(tokenUsage.promptTokens ?? 0).toLocaleString()}`,
      `${$t('ai_assistant.tokens_output')}: ${(tokenUsage.completionTokens ?? 0).toLocaleString()}`
    ];
    if (tokenUsage.cacheReadTokens) {
      parts.push(`${$t('ai_assistant.tokens_cache_read')}: ${tokenUsage.cacheReadTokens.toLocaleString()}`);
    }
    if (tokenUsage.contextTokens) {
      parts.push(`${$t('ai_assistant.tokens_context')}: ${tokenUsage.contextTokens.toLocaleString()}`);
    }
    return parts.join('\n');
  });

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

  // Persisted per-message agent steps (update_lesson_content, create_*, get_*, …).
  // Shown collapsed in the bubble so any past turn can reveal what it did. While the
  // live ProgressCard is showing this turn's steps (streaming, or stopped/step-limit),
  // it owns the display — suppress the bubble steps then to avoid showing them twice.
  const agentSteps = $derived(message.role === 'assistant' ? getAgentStepsForMessage(message) : []);
  const showAgentSteps = $derived(agentSteps.length > 0 && !(isLast && liveProgressActive));

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
   * mid-Spanish conversation, so no phrase list would hold. Any real `reasoning`
   * part is folded in too, for whenever extended thinking gets enabled.
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
     * The last tool call when there is one. When there ISN'T, this used to stay
     * at -1 and nothing was ever classified as narration, so a turn that never
     * called a tool rendered its entire chain-of-thought as the reply — which is
     * exactly what a teacher saw after a 5-minute turn that built nothing: the
     * one case where the model rambles is the one case with no boundary to fold
     * it behind. Falling back to the last text part restores the same rule with
     * the only marker left. A single text part stays whole: with nothing to
     * split on, guessing would be worse than showing it.
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
    // all. Promote the last block so the bubble is never blank.
    if (reply.length === 0 && thinking.length > 0) {
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
      : (message.parts ?? []).filter((part) => (part as { type?: string }).type === 'text')
  );
  const deferredPlanParts = $derived(
    (message.parts ?? []).filter((part) => isDeferredPlanPart(part as Record<string, unknown>))
  );
  // Build progress measured by the server (plan reconciled against the live course
  // once the round's writes landed), carried on the finish metadata. Previously the
  // checklist was drawn from the model's own update_course_todo_list output, which
  // drifted badly — it read 1/32 with ten lessons already written.
  const planProgress = $derived(message.role === 'assistant' ? message.metadata?.planProgress : undefined);
  const showPlanProgress = $derived(!!planProgress && planProgress.total > 0);
  const hasBubbleContent = $derived(
    inlineParts.length > 0 ||
      deferredPlanParts.length > 0 ||
      !!messageAttachment ||
      showAgentSteps ||
      showPlanProgress ||
      thinkingBlocks.length > 0
  );
  const showStreamingSpinner = $derived(message.role === 'assistant' && !hasBubbleContent && isStreaming && isLast);
  /**
   * Cards (plan, forms) need the full panel width to breathe.
   *
   * Assistant bubbles are full width too, and that is a streaming fix, not a
   * style choice: a bubble that hugs its content is re-measured on every token,
   * so during generation it visibly grows and snaps sideways line after line.
   * Pinning the width means only the height changes as text arrives. User
   * messages still hug — they appear complete, in one go, and never resize.
   */
  const isWideBubble = $derived(deferredPlanParts.length > 0 || message.role === 'assistant');

  /**
   * Markdown is re-parsed and its entire subtree replaced on every token. At
   * MiniMax's rate that is dozens of full re-layouts a second, and each one can
   * change the shape of the block: a list forms, a code fence opens, a heading
   * appears and pushes everything down. That churn is what reads as the box
   * "deforming" while the agent writes.
   *
   * So while THIS message is streaming, sample the parts on a fixed cadence
   * instead of rendering every token. The same text arrives at the same speed;
   * it just stops re-laying out between frames. Once streaming ends we render
   * `inlineParts` directly, so the final content is never a stale sample.
   */
  const STREAM_RENDER_INTERVAL_MS = 90;
  const isStreamingThisMessage = $derived(isStreaming && isLast);

  let sampledParts = $state<typeof inlineParts>([]);
  let lastSampleAt = 0;

  $effect(() => {
    const parts = inlineParts;

    if (!isStreamingThisMessage) return;

    const waitMs = STREAM_RENDER_INTERVAL_MS - (Date.now() - lastSampleAt);

    // First token of a turn commits immediately — otherwise the bubble would sit
    // empty for the length of one interval before anything appears.
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
  // implementation — hide the plan card's Implement/Request-changes buttons.
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
</script>

<div data-role={message.role} class="flex flex-col gap-1 {message.role === 'user' ? 'items-end' : 'items-start'}">
  {#if message.role === 'assistant' && !hasBubbleContent && !showStreamingSpinner}
    <!-- Assistant message has no renderable parts yet and isn't streaming — skip the empty bubble -->
  {:else}
    <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
    <div
      class="rounded-lg px-3 py-2 text-sm {isWideBubble ? 'w-full max-w-full' : 'max-w-[85%]'} {message.role === 'user'
        ? 'ui:bg-primary ui:text-primary-foreground'
        : 'ui:bg-muted'}"
      onclick={handleBubbleClick}
    >
      {#if showStreamingSpinner}
        <LoaderIcon size={16} class="ui:text-muted-foreground animate-spin" />
      {/if}
      {#if messageAttachment}
        <div
          class="mb-2 flex items-center gap-2 rounded-md px-2 py-1 text-xs {message.role === 'user'
            ? 'bg-white/15 text-white/90'
            : 'ui:bg-background/70 ui:text-muted-foreground'}"
        >
          <FileTextIcon size={12} class="shrink-0" />
          <span class="min-w-0 truncate">{messageAttachment.name}</span>
        </div>
      {/if}

      {#if showAgentSteps}
        <div class="mb-2">
          <AgentSteps steps={agentSteps} {courseId} onNavigate={onMentionClick} />
        </div>
      {/if}

      {#if thinkingBlocks.length > 0}
        <ThinkingBlock blocks={thinkingBlocks} isStreaming={isStreaming && isLast} />
      {/if}

      {#each partsToRender as part, partIndex (partIndex)}
        {#if part.type === 'text'}
          <div
            class="ai-chat-prose prose prose-sm dark:prose-invert max-w-none break-words {message.role === 'user' &&
              'ui:text-primary-foreground!'}"
          >
            <!-- eslint-disable-next-line svelte/no-at-html-tags -->
            {@html renderMentions(renderMarkdown(part.text as string), courseId)}
          </div>
        {/if}
      {/each}

      {#each deferredPlanParts as part, partIndex (partIndex)}
        {@const toolName = getAgentToolName(part)}
        {@const toolResult = getAgentToolResult(part)}
        {@const toolStatus = getAgentToolStatus(part)}
        {@const errorText = getPartErrorText(part)}
        {#if toolName === 'generate_course_plan' && toolStatus === 'completed'}
          <div class="mt-3">
            <PlanView
              plan={toolResult as CoursePlan}
              onImplement={onImplementPlan}
              onRequestChanges={onRequestPlanChanges}
              isBusy={isStreaming}
              implemented={planAlreadyImplemented}
            />
          </div>
        {:else if toolName === 'ask_template_questions' && (toolStatus === 'completed' || toolStatus === 'in_progress')}
          {@const merged = (toolResult ?? getAgentToolInput(part)) as
            | { templateId?: CourseTemplateId; fields?: TemplateFormField[] }
            | undefined}
          {#if merged?.templateId}
            {@const canonicalFields = mergeTemplateFieldsWithRegistry(merged.templateId, merged.fields)}
            {#if canonicalFields.length > 0}
              <div class="mt-3">
                <TemplateFormCard
                  templateId={merged.templateId}
                  fields={canonicalFields}
                  allMessages={messages}
                  submitted={isTemplateFormResolved(messages, merged.templateId)}
                  disableFormInputs={toolStatus === 'in_progress'}
                  onSubmit={onSubmitTemplateAnswers}
                  onSkip={onSkipTemplateForm}
                />
              </div>
            {/if}
          {/if}
        {:else if toolName === 'ask_discovery_questions' && (toolStatus === 'completed' || toolStatus === 'in_progress')}
          {@const data = (toolResult ?? getAgentToolInput(part)) as
            | { formId?: string; title?: string; intro?: string; fields?: TemplateFormField[] }
            | undefined}
          {#if data?.formId && data?.fields?.length}
            <div class="mt-3">
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
            </div>
          {/if}
        {:else}
          <div class="ui:bg-background/70 mt-3 flex items-center gap-2 rounded-md px-2 py-1.5 text-xs">
            {#if toolStatus === 'completed' && toolName}
              <CheckIcon size={12} class="ui:text-primary shrink-0" />
              <ToolLine line={getCompletedToolLine(toolName, toolResult)} {courseId} onNavigate={onMentionClick} />
            {:else if toolStatus === 'failed' && toolName}
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
            {:else if toolStatus === 'in_progress' && toolName}
              <LoaderIcon size={12} class="ui:text-primary shrink-0 animate-spin" />
              <ToolLine line={getPendingToolLine(toolName)} {courseId} onNavigate={onMentionClick} />
            {:else}
              <CircleIcon size={12} class="ui:text-muted-foreground shrink-0" />
              {#if toolName}
                <span class="ui:text-muted-foreground">
                  <ToolLine line={getPendingToolLine(toolName)} {courseId} onNavigate={onMentionClick} />
                </span>
              {:else}
                <span class="ui:text-muted-foreground">{$t('ai_assistant.generic_working')}</span>
              {/if}
            {/if}
          </div>
        {/if}
      {/each}

      {#if showPlanProgress && planProgress}
        <TodoChecklist progress={planProgress} />
      {/if}

      <!--
        Este pie se esconde entero, no se convierte a porcentaje: un mensaje
        suelto no tiene cupo contra el cual medirse. Y dejarlo anularía todo lo
        demás — no sirve esconder el total del mes si cada respuesta sigue
        anunciando "1.240.000 fichas". Es diagnóstico de quien opera la
        plataforma, no información que la empresa use para trabajar.
      -->
      {#if message.role === 'assistant' && tokenUsage && $isPlatformAdmin}
        <div class="mt-1 flex justify-end">
          <span class="ui:text-muted-foreground text-[10px]" title={tokenUsageBreakdown}>
            {headlineTokens.toLocaleString()}
            {$t(headlineIsContext ? 'ai_assistant.tokens_context_label' : 'ai_assistant.tokens_label')}
            {#if cachedSharePercent !== null}
              · {$t('ai_assistant.tokens_from_cache', { percent: cachedSharePercent })}
            {/if}
          </span>
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  /* Reset global `apps/dashboard/src/app.css` `.prose p { mb-4 }` for chat bubbles */
  :global(.ai-chat-prose.prose p) {
    margin-bottom: 0;
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

  :global([data-role='user'] a),
  :global([data-role='user'] .prose a) {
    color: var(--primary-foreground);
  }

  :global([data-role='user'] .prose code:not(pre code)) {
    color: rgb(9 9 11);
    background-color: rgb(255 255 255 / 0.95);
  }

  :global(.mention-link:hover) {
    opacity: 0.8;
  }
</style>
