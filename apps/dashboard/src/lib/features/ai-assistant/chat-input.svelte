<script lang="ts">
  import { onMount } from 'svelte';
  import { browser } from '$app/environment';
  import { page } from '$app/state';
  import { Button } from '@cio/ui/base/button';
  import { IconButton } from '@cio/ui/custom/icon-button';
  import { ChatTextarea, type MentionItem } from '@cio/ui/custom/chat-textarea';
  import { LessonIcon, ExerciseIcon } from '@cio/ui/custom/moving-icons';
import PaperclipIcon from '@lucide/svelte/icons/paperclip';
import SquareIcon from '@lucide/svelte/icons/square';
import XIcon from '@lucide/svelte/icons/x';
import FileTextIcon from '@lucide/svelte/icons/file-text';
import LoaderIcon from '@lucide/svelte/icons/loader';
import RotateCwIcon from '@lucide/svelte/icons/rotate-cw';
import TableOfContentsIcon from '@lucide/svelte/icons/table-of-contents';
import BookOpenIcon from '@lucide/svelte/icons/book-open';
  import { t } from '$lib/utils/functions/translations';
  import { resolve } from '$app/paths';
  import { currentOrgPath, isFreePlan } from '$lib/utils/store/org';
  import { openUpgradeModal } from '$lib/utils/functions/org';
  import { AI_AGENT_RUNNING_WARNING_DISMISSED_KEY } from '$features/ai-assistant/utils/constants';

  interface UploadedDocument {
    id: string;
    name: string;
  }

  interface Props {
    inputValue: string;
    isStreaming: boolean;
    isExhausted: boolean;
    isUploading: boolean;
    error: Error | null | undefined;
    /** True when there is a last-sent message we can re-send with Retry. */
    canRetry?: boolean;
    mentionItems: MentionItem[];
    uploadedDocument: UploadedDocument | null;
    isStudent?: boolean;
    /** Set to 'LEARNER_CAP_REACHED' | 'POOL_EXHAUSTED' | 'AI_TUTOR_DISABLED' to render the take-a-break empty state. */
    tutorBlocked?: 'LEARNER_CAP_REACHED' | 'POOL_EXHAUSTED' | 'AI_TUTOR_DISABLED' | null;
    /** Bump this number to programmatically focus the input (e.g. from the plan card's "Request changes"). */
    focusSignal?: number;
    /** Total number of sources uploaded to this course's Sources panel. Drives
     * a small chip that lets the user know how many documents the agent is
     * reading on their behalf. */
    courseSourcesCount?: number;
    onSend: () => void;
    onRetry?: () => void;
    onStop: () => void;
    onFileSelect: (file: File) => void;
    onRemoveDocument: () => void;
  }

  let {
    inputValue = $bindable(),
    isStreaming,
    isExhausted,
    isUploading,
    error,
    canRetry = false,
    mentionItems,
    uploadedDocument,
    isStudent = false,
    tutorBlocked = null,
    focusSignal = 0,
    courseSourcesCount = 0,
    onSend,
    onRetry,
    onStop,
    onFileSelect,
    onRemoveDocument
  }: Props = $props();

  let lastFocusSignal = $state(0);

  $effect(() => {
    if (focusSignal === lastFocusSignal) return;

    lastFocusSignal = focusSignal;

    requestAnimationFrame(() => {
      chatTextareaRef?.focus();
    });
  });

  function tutorBlockedMessage(reason: NonNullable<typeof tutorBlocked>): string {
    if (reason === 'LEARNER_CAP_REACHED') return t.get('aiTutor.takeABreak.learnerCap');
    if (reason === 'POOL_EXHAUSTED') return t.get('aiTutor.takeABreak.poolExhausted');
    return t.get('aiTutor.takeABreak.disabled');
  }

  let fileInputEl: HTMLInputElement | undefined = $state();
  let chatTextareaRef: HTMLTextAreaElement | null = $state(null);
  let wasBusy = $state(false);

  function readAgentRunningWarningDismissed() {
    if (!browser) {
      return false;
    }

    try {
      return localStorage.getItem(AI_AGENT_RUNNING_WARNING_DISMISSED_KEY) === '1';
    } catch {
      return false;
    }
  }

  let agentRunningWarningDismissed = $state(readAgentRunningWarningDismissed());

  onMount(() => {
    agentRunningWarningDismissed = readAgentRunningWarningDismissed();
  });

  function dismissAgentRunningWarning() {
    agentRunningWarningDismissed = true;

    try {
      localStorage.setItem(AI_AGENT_RUNNING_WARNING_DISMISSED_KEY, '1');
    } catch {
      // localStorage unavailable
    }
  }

  $effect(() => {
    const isBusy = isStreaming || isUploading;

    if (isBusy) {
      wasBusy = true;
      return;
    }

    if (!wasBusy || isExhausted || !chatTextareaRef) {
      return;
    }

    wasBusy = false;

    requestAnimationFrame(() => {
      chatTextareaRef?.focus();
    });
  });

  function handlePaperclipClick() {
    if ($isFreePlan) {
      openUpgradeModal();
      return;
    }
    fileInputEl?.click();
  }

  function handleFileChange(e: Event) {
    const target = e.currentTarget as HTMLInputElement;
    const file = target.files?.[0];
    if (file) {
      onFileSelect(file);
      target.value = '';
    }
  }

  function getTypeLabel(item: MentionItem) {
    if (item.type === 'EXERCISE') return t.get('ai_assistant.mention_exercise');
    if (item.type === 'SECTION') return t.get('ai_assistant.mention_section');

    return t.get('ai_assistant.mention_lesson');
  }

  function getUserFriendlyErrorMessage(errorMessage: string): string {
    const lowerMessage = errorMessage.toLowerCase();

    if (lowerMessage.includes('quota exceeded') || lowerMessage.includes('rate limit')) {
      const retryMatch = errorMessage.match(/retry in (\d+(?:\.\d+)?)/i);
      const waitSeconds = retryMatch ? Math.ceil(parseFloat(retryMatch[1])) : null;

      return waitSeconds
        ? t.get('ai_assistant.error_rate_limit_with_wait', { seconds: waitSeconds })
        : t.get('ai_assistant.error_rate_limit');
    }

    if (lowerMessage.includes('context length') || lowerMessage.includes('too long')) {
      return t.get('ai_assistant.error_context_too_long');
    }

    if (lowerMessage.includes('network') || lowerMessage.includes('connection')) {
      return t.get('ai_assistant.error_network');
    }

    return errorMessage;
  }

  const displayErrorMessage = $derived(error ? getUserFriendlyErrorMessage(error.message) : null);
</script>

<input
  bind:this={fileInputEl}
  type="file"
  accept=".pdf,.docx,.pptx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation"
  class="hidden"
  onchange={handleFileChange}
/>

{#if tutorBlocked}
  <div class="border-t px-3 py-4">
    <div class="ui:bg-muted/40 ui:text-muted-foreground rounded-md border px-3 py-3 text-sm">
      <p class="ui:text-foreground mb-1 text-sm font-medium">{$t('aiTutor.takeABreak.title')}</p>
      <p class="text-xs">{tutorBlockedMessage(tutorBlocked)}</p>
    </div>
  </div>
{:else}
  <div class="border-t px-4 pt-3 pb-2">
    {#if isExhausted}
      <div
        class="flex flex-col gap-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 sm:flex-row sm:items-center sm:justify-between dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300"
      >
        <span>{$t('ai_assistant.tokens_exhausted')}</span>
        {#if $currentOrgPath !== '#'}
          <Button
            variant="outline"
            size="sm"
            href={`${resolve(`${$currentOrgPath}/settings/ai-credits`)}#buy-tokens`}
            class="w-full shrink-0 sm:w-auto"
          >
            {$t('ai_assistant.tokens_exhausted_buy_more')}
          </Button>
        {/if}
      </div>
    {:else}
      {#if isStreaming && !agentRunningWarningDismissed && !isStudent}
        <div
          class="mb-2 flex items-start gap-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300"
        >
          <span class="min-w-0 flex-1">{$t('ai_assistant.agent_running_warning')}</span>
          <IconButton
            variant="outline"
            size="icon-xs"
            type="button"
            tooltip={t.get('ai_assistant.agent_running_warning_dismiss')}
            class="border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200 dark:hover:bg-amber-900"
            onclick={dismissAgentRunningWarning}
          >
            <XIcon size={12} />
          </IconButton>
        </div>
      {/if}

      {#if displayErrorMessage}
        <div
          class="mb-2 flex flex-col gap-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 sm:flex-row sm:items-center sm:justify-between sm:gap-3 dark:border-red-800 dark:bg-red-950 dark:text-red-300"
        >
          <span class="min-w-0 flex-1">{displayErrorMessage}</span>
          {#if onRetry && canRetry && !isStreaming}
            <button
              type="button"
              onclick={onRetry}
              class="inline-flex shrink-0 items-center gap-1.5 rounded border border-red-300 bg-white px-2.5 py-1 text-xs font-medium text-red-700 transition-colors hover:bg-red-100 dark:border-red-700 dark:bg-red-950 dark:text-red-200 dark:hover:bg-red-900"
            >
              <RotateCwIcon size={12} />
              {$t('ai_assistant.error_retry')}
            </button>
          {/if}
        </div>
      {/if}

      {#if isUploading}
        <div class="mb-2 flex items-center gap-2 rounded border px-3 py-2 text-xs">
          <LoaderIcon size={12} class="animate-spin" />
          <span class="ui:text-muted-foreground">{$t('ai_assistant.uploading_document')}</span>
        </div>
      {:else if uploadedDocument}
        <div class="mb-2 flex items-center gap-2 rounded border px-3 py-2 text-xs">
          <FileTextIcon size={12} class="ui:text-primary shrink-0" />
          <span class="min-w-0 flex-1 truncate">{uploadedDocument.name}</span>
          <button
            onclick={onRemoveDocument}
            class="ui:text-muted-foreground hover:ui:text-foreground shrink-0 rounded p-0.5 transition-colors"
          >
            <XIcon size={12} />
          </button>
        </div>
      {:else if courseSourcesCount > 0 && !isStudent}
        <a
          href={resolve(`/courses/${(page?.params?.id ?? '') as string}/sources`)}
          class="ui:text-muted-foreground hover:ui:text-foreground mb-2 flex items-center gap-2 rounded border px-3 py-2 text-xs transition-colors"
          data-sveltekit-preload-data="off"
        >
          <BookOpenIcon size={12} class="shrink-0" />
          <span class="min-w-0 flex-1 truncate">
            {courseSourcesCount === 1
              ? $t('course.sources.indicator_single')
              : $t('course.sources.indicator_multiple', { count: courseSourcesCount })}
          </span>
          <span class="shrink-0 text-[10px] uppercase tracking-wide">→</span>
        </a>
      {/if}

      <div class="flex items-end gap-2">
        <ChatTextarea
          bind:ref={chatTextareaRef}
          bind:value={inputValue}
          {mentionItems}
          onSubmit={onSend}
          placeholder={$t('ai_assistant.input_placeholder')}
          disabled={isStreaming || isUploading}
          typeLabel={getTypeLabel}
          emptyMessage={t.get('ai_assistant.mention_no_results')}
          rows={2}
          class="flex-1"
        >
          {#snippet icon({ item })}
            {#if item.type === 'EXERCISE'}
              <ExerciseIcon size={14} />
            {:else if item.type === 'SECTION'}
              <TableOfContentsIcon size={14} />
            {:else}
              <LessonIcon size={14} />
            {/if}
          {/snippet}

          {#snippet actions()}
            {#if !isStudent}
              <button
                onclick={handlePaperclipClick}
                disabled={isUploading}
                class="ui:text-muted-foreground hover:ui:bg-muted shrink-0 rounded-md p-1.5 transition-colors disabled:pointer-events-none disabled:opacity-40"
                title={$isFreePlan ? $t('ai_assistant.upgrade_to_upload') : $t('ai_assistant.attach_document')}
              >
                <PaperclipIcon size={16} />
              </button>
            {/if}

            <div class="flex-1"></div>

            {#if isStreaming}
              <Button size="icon" variant="outline" onclick={onStop} class="size-7 shrink-0">
                <SquareIcon size={12} />
              </Button>
            {:else}
              <Button size="sm" onclick={onSend} disabled={!inputValue.trim()} class="shrink-0">
                {$t('ai_assistant.send')}
              </Button>
            {/if}
          {/snippet}
        </ChatTextarea>
      </div>
    {/if}
  </div>
{/if}
