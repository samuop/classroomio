<script lang="ts">
  import { onMount } from 'svelte';
  import { browser } from '$app/environment';
  import { Button } from '@cio/ui/base/button';
  import { ChatTextarea, type MentionItem } from '@cio/ui/custom/chat-textarea';
  import { LessonIcon, ExerciseIcon } from '@cio/ui/custom/moving-icons';
  import PaperclipIcon from '@lucide/svelte/icons/paperclip';
  import ImagePlusIcon from '@lucide/svelte/icons/image-plus';
  import ArrowUpIcon from '@lucide/svelte/icons/arrow-up';
  import SquareIcon from '@lucide/svelte/icons/square';
  import XIcon from '@lucide/svelte/icons/x';
  import FileTextIcon from '@lucide/svelte/icons/file-text';
  import LoaderIcon from '@lucide/svelte/icons/loader';
  import AlertCircleIcon from '@lucide/svelte/icons/alert-circle';
  import RotateCwIcon from '@lucide/svelte/icons/rotate-cw';
  import TableOfContentsIcon from '@lucide/svelte/icons/table-of-contents';
  import { t } from '$lib/utils/functions/translations';
  import { resolve } from '$app/paths';
  import { currentOrgPath, isFreePlan } from '$lib/utils/store/org';
  import { openUpgradeModal } from '$lib/utils/functions/org';
  import { AI_AGENT_RUNNING_WARNING_DISMISSED_KEY } from '$features/ai-assistant/utils/constants';
  import ContextIndicator from '$features/ai-assistant/context-indicator.svelte';
  import type { ContextUsage } from '$features/ai-assistant/utils/context-utils';
  import { imagenesDe, TIPOS_DE_IMAGEN, type AdjuntoDeImagen } from '$features/ai-assistant/utils/chat-attachments';

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
    /** Bump this number to programmatically focus the input. */
    focusSignal?: number;
    /** Context-window occupancy, shown beside Send/Stop. Omit to hide the gauge. */
    contextUsage?: ContextUsage;
    /** Imágenes adjuntas al mensaje que se está escribiendo. */
    attachments?: AdjuntoDeImagen[];
    /** El modelo ve imágenes y quien escribe es del equipo del curso. */
    canAttachImages?: boolean;
    /** Hay algo para mandar y nada subiendo. Ver `puedeEnviar`. */
    canSend: boolean;
    onSend: () => void;
    onRetry?: () => void;
    onStop: () => void;
    onFileSelect: (file: File) => void;
    onRemoveDocument: () => void;
    onAddImages?: (files: File[]) => void;
    onRemoveAttachment?: (id: string) => void;
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
    contextUsage,
    attachments = [],
    canAttachImages = false,
    canSend,
    onSend,
    onRetry,
    onStop,
    onFileSelect,
    onRemoveDocument,
    onAddImages,
    onRemoveAttachment
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
  let imageInputEl: HTMLInputElement | undefined = $state();
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

  function handleImageButtonClick() {
    if ($isFreePlan) {
      openUpgradeModal();
      return;
    }
    imageInputEl?.click();
  }

  function handleImageChange(e: Event) {
    const target = e.currentTarget as HTMLInputElement;
    const files = Array.from(target.files ?? []);

    if (files.length > 0) onAddImages?.(files);

    target.value = '';
  }

  /**
   * Pegar una captura es la forma más rápida de mostrar algo: sin guardarla en
   * un archivo primero. Sólo se intercepta si el portapapeles trae imágenes y
   * no texto — pegar texto sigue siendo pegar texto.
   */
  function handlePaste(event: ClipboardEvent) {
    if (!canAttachImages || !onAddImages) return;

    const imagenes = imagenesDe(event.clipboardData);

    if (imagenes.length === 0) return;

    event.preventDefault();

    if ($isFreePlan) {
      openUpgradeModal();
      return;
    }

    onAddImages(imagenes);
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
  const hasHeaderContent = $derived(attachments.length > 0 || isUploading || !!uploadedDocument);

  const iconButtonClass =
    'ui:text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-(--muted) hover:text-(--foreground) disabled:pointer-events-none disabled:opacity-40';
</script>

<input
  bind:this={fileInputEl}
  type="file"
  accept=".pdf,.docx,.pptx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation"
  class="hidden"
  onchange={handleFileChange}
/>

<input
  bind:this={imageInputEl}
  type="file"
  accept={TIPOS_DE_IMAGEN.join(',')}
  multiple
  class="hidden"
  onchange={handleImageChange}
/>

{#if tutorBlocked}
  <div class="px-3 py-4">
    <div class="ui:text-muted-foreground rounded-xl border px-3 py-3 text-sm">
      <p class="ui:text-foreground mb-1 text-sm font-medium">{$t('aiTutor.takeABreak.title')}</p>
      <p class="text-xs">{tutorBlockedMessage(tutorBlocked)}</p>
    </div>
  </div>
{:else}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="px-4 pt-2 pb-4" onpaste={handlePaste}>
    {#if isExhausted}
      <div
        class="flex flex-col gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 sm:flex-row sm:items-center sm:justify-between dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300"
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
        <div class="ui:text-muted-foreground mb-2 flex items-start gap-2 px-1 text-xs">
          <span class="min-w-0 flex-1">{$t('ai_assistant.agent_running_warning')}</span>
          <button
            type="button"
            class="shrink-0 rounded p-0.5 transition-colors hover:text-(--foreground)"
            title={$t('ai_assistant.agent_running_warning_dismiss')}
            aria-label={$t('ai_assistant.agent_running_warning_dismiss')}
            onclick={dismissAgentRunningWarning}
          >
            <XIcon size={12} />
          </button>
        </div>
      {/if}

      {#if displayErrorMessage}
        <div
          class="mb-2 flex flex-col gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 sm:flex-row sm:items-center sm:justify-between sm:gap-3 dark:border-red-800 dark:bg-red-950 dark:text-red-300"
        >
          <span class="min-w-0 flex-1">{displayErrorMessage}</span>
          {#if onRetry && canRetry && !isStreaming}
            <button
              type="button"
              onclick={onRetry}
              class="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-red-300 bg-white px-2.5 py-1 text-xs font-medium text-red-700 transition-colors hover:bg-red-100 dark:border-red-700 dark:bg-red-950 dark:text-red-200 dark:hover:bg-red-900"
            >
              <RotateCwIcon size={12} />
              {$t('ai_assistant.error_retry')}
            </button>
          {/if}
        </div>
      {/if}

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
        frameClass="rounded-2xl! shadow-sm!"
        actionsClass="gap-1.5! px-2.5! pb-2.5!"
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

        {#snippet header()}
          {#if hasHeaderContent}
            <div class="flex flex-wrap items-center gap-2 px-3 pt-3">
              {#each attachments as adjunto (adjunto.id)}
                <div class="group/adjunto relative size-14 shrink-0 overflow-hidden rounded-lg border">
                  <img
                    src={adjunto.vistaPrevia}
                    alt={$t('ai_assistant.attachments.image_alt', { name: adjunto.nombre })}
                    class="size-full object-cover {adjunto.estado === 'lista' ? '' : 'opacity-50'}"
                  />
                  {#if adjunto.estado === 'subiendo'}
                    <span
                      class="absolute inset-0 flex items-center justify-center"
                      title={$t('ai_assistant.attachments.uploading')}
                    >
                      <LoaderIcon size={16} class="animate-spin" />
                    </span>
                  {:else if adjunto.estado === 'error'}
                    <span
                      class="absolute inset-0 flex items-center justify-center bg-red-500/20 text-red-600"
                      title={$t('ai_assistant.attachments.failed')}
                    >
                      <AlertCircleIcon size={16} />
                    </span>
                  {/if}
                  <button
                    type="button"
                    class="absolute top-0.5 right-0.5 flex size-5 items-center justify-center rounded-full bg-black/60 text-white transition-opacity focus-visible:opacity-100 sm:opacity-0 sm:group-hover/adjunto:opacity-100"
                    title={$t('ai_assistant.attachments.remove')}
                    aria-label={$t('ai_assistant.attachments.remove')}
                    onmousedown={(event) => event.preventDefault()}
                    onclick={() => onRemoveAttachment?.(adjunto.id)}
                  >
                    <XIcon size={11} />
                  </button>
                </div>
              {/each}

              {#if isUploading}
                <div class="ui:text-muted-foreground flex h-8 items-center gap-2 rounded-lg border px-2.5 text-xs">
                  <LoaderIcon size={12} class="animate-spin" />
                  <span>{$t('ai_assistant.uploading_document')}</span>
                </div>
              {:else if uploadedDocument}
                <div class="flex h-8 max-w-full items-center gap-2 rounded-lg border px-2.5 text-xs">
                  <FileTextIcon size={12} class="ui:text-primary shrink-0" />
                  <span class="min-w-0 truncate">{uploadedDocument.name}</span>
                  <button
                    type="button"
                    onclick={onRemoveDocument}
                    class="ui:text-muted-foreground shrink-0 rounded p-0.5 transition-colors hover:text-(--foreground)"
                    aria-label={$t('ai_assistant.attachments.remove')}
                  >
                    <XIcon size={12} />
                  </button>
                </div>
              {/if}
            </div>
          {/if}
        {/snippet}

        {#snippet actions()}
          {#if !isStudent}
            <button
              type="button"
              onmousedown={(event) => event.preventDefault()}
              onclick={handlePaperclipClick}
              disabled={isUploading}
              class={iconButtonClass}
              title={$isFreePlan ? $t('ai_assistant.upgrade_to_upload') : $t('ai_assistant.attach_document')}
              aria-label={$t('ai_assistant.attach_document')}
            >
              <PaperclipIcon size={16} />
            </button>
          {/if}

          {#if canAttachImages}
            <button
              type="button"
              onmousedown={(event) => event.preventDefault()}
              onclick={handleImageButtonClick}
              class={iconButtonClass}
              title={$t('ai_assistant.attachments.add_image')}
              aria-label={$t('ai_assistant.attachments.add_image')}
            >
              <ImagePlusIcon size={16} />
            </button>
          {/if}

          <div class="flex-1"></div>

          <!-- Beside the button, where the cost of the next turn is decided. -->
          {#if contextUsage}
            <ContextIndicator {contextUsage} />
          {/if}

          <!--
            `mousedown` preventDefault: pulsar el boton NO saca el foco del
            textarea. Con el foco se va el teclado del telefono, el panel recupera
            esa altura, y el boton se corre ENTRE que apoyas el dedo y lo levantas:
            el clic cae donde el boton ya no esta.

            `() => onSend()` y NO `onSend`: un `onclick` le entrega el MouseEvent
            como primer argumento, y `handleSend(textOverride?: string)` lo recibia
            ahi y se caia en silencio. TypeScript no lo ve.
          -->
          {#if isStreaming}
            <button
              type="button"
              onmousedown={(event) => event.preventDefault()}
              onclick={onStop}
              class="flex size-8 shrink-0 items-center justify-center rounded-full bg-(--foreground) text-(--background) transition-opacity hover:opacity-85"
              title={$t('ai_assistant.stop')}
              aria-label={$t('ai_assistant.stop')}
            >
              <SquareIcon size={11} class="fill-current" />
            </button>
          {:else}
            <button
              type="button"
              onmousedown={(event) => event.preventDefault()}
              onclick={() => onSend()}
              disabled={!canSend}
              class="flex size-8 shrink-0 items-center justify-center rounded-full bg-(--primary) text-(--primary-foreground) transition-opacity hover:opacity-90 disabled:pointer-events-none disabled:opacity-30"
              title={$t('ai_assistant.send')}
              aria-label={$t('ai_assistant.send')}
            >
              <ArrowUpIcon size={16} />
            </button>
          {/if}
        {/snippet}
      </ChatTextarea>
    {/if}
  </div>
{/if}
