<script lang="ts">
  import * as Popover from '@cio/ui/base/popover';
  import { Input } from '@cio/ui/base/input';
  import { Tooltip, Provider, Trigger, Content } from '@cio/ui/base/tooltip';
  import { PUBLIC_IS_SELFHOSTED } from '$env/static/public';
  import { tick } from 'svelte';

  // Self-hosted instances use their own provider key with no monthly cap, so the
  // billing meter (used / allowance %) is meaningless — show informational use only.
  const isSelfHosted = PUBLIC_IS_SELFHOSTED === 'true';
  import SparklesIcon from '@lucide/svelte/icons/sparkles';
  import XIcon from '@lucide/svelte/icons/x';
  import PlusIcon from '@lucide/svelte/icons/plus';
  import HistoryIcon from '@lucide/svelte/icons/history';
  import ChatHistoryPopover from '$features/ai-assistant/chat-history-popover.svelte';
  import { closeAiAssistant } from '$features/ai-assistant/utils/store';
  import { t } from '$lib/utils/functions/translations';
  import { isPlatformAdmin } from '$lib/utils/store/user';
  import { IconButton } from '@cio/ui/custom/icon-button';
  import { Button } from '@cio/ui/base/button';

  interface Conversation {
    id: string;
    title: string | null;
    updatedAt: string;
  }

  interface TokenUsage {
    used: number;
    allowance: number;
    remaining: number;
  }

  interface StudentMessageUsage {
    used: number;
    cap: number;
  }

  interface Props {
    tokenUsage: TokenUsage | null;
    isStudent: boolean;
    studentMessageUsage: StudentMessageUsage | null;
    conversations: Conversation[];
    activeConversationId: string | null;
    conversationTitle: string | null;
    isNewChatDisabled: boolean;
    onNewChat: () => void;
    onLoadConversation: (id: string) => void;
    onDeleteConversation: (id: string) => void;
    /** Resolves on success; rejects with Error when rename fails (message is user-presentable). */
    onRenameConversation: (id: string, title: string) => Promise<void>;
  }

  let {
    tokenUsage,
    isStudent,
    studentMessageUsage,
    conversations,
    activeConversationId,
    conversationTitle,
    isNewChatDisabled,
    onNewChat,
    onLoadConversation,
    onDeleteConversation,
    onRenameConversation
  }: Props = $props();

  let historyPopoverOpen = $state(false);

  let editingConversationTitle = $state(false);
  let draftConversationTitle = $state('');
  let renameConversationError = $state<string | null>(null);
  let titleInputRef: HTMLInputElement | null = $state(null);

  let renameCommitInFlight = $state(false);
  let snapshotConversationIdForRename = $state<string | null>(null);

  const hasConversationTitle = $derived(!!conversationTitle && conversationTitle !== 'New conversation');

  const canRenameConversation = $derived(Boolean(activeConversationId && hasConversationTitle));

  function handleLoadConversation(id: string) {
    onLoadConversation(id);
    historyPopoverOpen = false;
  }

  function cancelRenameConversation() {
    if (renameCommitInFlight) {
      return;
    }

    if (!editingConversationTitle) {
      return;
    }

    editingConversationTitle = false;
    renameConversationError = null;
    draftConversationTitle = conversationTitle ?? '';
    snapshotConversationIdForRename = null;
  }

  $effect(() => {
    if (
      editingConversationTitle &&
      snapshotConversationIdForRename != null &&
      activeConversationId !== snapshotConversationIdForRename
    ) {
      cancelRenameConversation();
    }
  });

  async function startRenameConversation() {
    if (!canRenameConversation || !activeConversationId || !conversationTitle) {
      return;
    }

    renameConversationError = null;
    draftConversationTitle = conversationTitle;
    snapshotConversationIdForRename = activeConversationId;
    editingConversationTitle = true;

    await tick();

    titleInputRef?.focus();
    titleInputRef?.select();
  }

  async function commitRenameConversation() {
    if (!activeConversationId) {
      return;
    }

    const trimmedTitle = draftConversationTitle.trim();

    if (trimmedTitle.length === 0) {
      cancelRenameConversation();

      return;
    }

    if (trimmedTitle === conversationTitle) {
      editingConversationTitle = false;
      renameConversationError = null;
      snapshotConversationIdForRename = null;

      return;
    }

    renameCommitInFlight = true;

    try {
      await onRenameConversation(activeConversationId, trimmedTitle);
      editingConversationTitle = false;
      renameConversationError = null;
      snapshotConversationIdForRename = null;
    } catch (renameError) {
      const message = renameError instanceof Error ? renameError.message : t.get('ai_assistant.rename_chat_failed');

      renameConversationError = message;
    } finally {
      renameCommitInFlight = false;
    }
  }

  function handleTitleKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      event.preventDefault();
      void commitRenameConversation();
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      cancelRenameConversation();
    }
  }

  /**
   * El cupo, en la misma línea que el título.
   *
   * Ocupaba una fila entera debajo del encabezado —rótulo, porcentaje y barra—
   * para un número que se mira de vez en cuando. Queda una barra corta con el
   * porcentaje, y el rótulo pasa al globo de ayuda. Barra y no anillo a
   * propósito: el anillo de abajo, junto a Enviar, es la ventana de contexto, y
   * dos anillos con dos porcentajes distintos se confunden.
   *
   * Las reglas de qué se ve no cambian:
   * - el alumno ve sólo el porcentaje (hoy no se dibuja: no hay tope por alumno);
   * - fuera del administrador de plataforma no se muestran fichas ni el total,
   *   porque con el total y el porcentaje lo consumido se despeja con una división;
   * - self-hosted no tiene cupo, así que no hay contador.
   */
  const cupo = $derived.by((): { porcentaje: number; detalle: string } | null => {
    if (isStudent && studentMessageUsage && studentMessageUsage.cap > 0) {
      const porcentaje = Math.min(100, Math.round((studentMessageUsage.used / studentMessageUsage.cap) * 100));

      return {
        porcentaje,
        detalle: $isPlatformAdmin
          ? `${studentMessageUsage.used.toLocaleString()} / ${studentMessageUsage.cap.toLocaleString()} ${t.get('ai_assistant.messages_used_label')}`
          : `${t.get('ai_assistant.messages_percent_label')}: ${porcentaje}%`
      };
    }

    if (!isStudent && !isSelfHosted && tokenUsage && tokenUsage.used + tokenUsage.remaining > 0) {
      const total = tokenUsage.used + tokenUsage.remaining;
      const porcentaje = Math.min(100, Math.round((tokenUsage.used / total) * 100));

      return {
        porcentaje,
        detalle: $isPlatformAdmin
          ? `${tokenUsage.used.toLocaleString()} / ${total.toLocaleString()} ${t.get('ai_assistant.tokens_label')}`
          : `${t.get('settings.ai_credits.chart.total_percent')}: ${porcentaje}%`
      };
    }

    return null;
  });

  const colorDelCupo = $derived(
    !cupo ? '' : cupo.porcentaje > 90 ? 'bg-red-500' : cupo.porcentaje > 70 ? 'bg-amber-500' : 'bg-(--primary)'
  );
</script>

<div class="flex items-center gap-2 border-b px-4 py-2.5">
  <SparklesIcon size={16} class="ui:text-primary shrink-0" />

  <div class="min-w-0 flex-1">
    {#if editingConversationTitle}
      <Input
        bind:ref={titleInputRef}
        bind:value={draftConversationTitle}
        class="ui:h-7 ui:min-h-0 ui:px-1.5 ui:py-0 text-sm"
        placeholder={$t('ai_assistant.rename_chat_placeholder')}
        aria-label={$t('ai_assistant.rename_chat_input_aria')}
        onkeydown={handleTitleKeydown}
        onblur={cancelRenameConversation}
      />
      {#if renameConversationError}
        <p class="ui:text-destructive mt-0.5 text-[10px]">{renameConversationError}</p>
      {/if}
    {:else if hasConversationTitle}
      <!-- El título de la conversación ES el encabezado: «Asistente» ya lo dice el panel. -->
      <button
        type="button"
        class="block max-w-full cursor-pointer truncate rounded-md border border-transparent px-1.5 py-0.5 text-left text-sm font-medium transition-colors hover:border-(--border) hover:bg-(--muted)/40 disabled:cursor-default"
        aria-label={$t('ai_assistant.rename_chat_aria')}
        title={conversationTitle}
        disabled={!canRenameConversation}
        onclick={startRenameConversation}
      >
        {conversationTitle}
      </button>
    {:else}
      <h3 class="px-1.5 text-sm font-semibold">{$t('course.navItems.nav_ai_assistant')}</h3>
    {/if}
  </div>

  {#if cupo}
    <Provider>
      <Tooltip>
        <Trigger>
          <span
            class="ui:text-muted-foreground flex shrink-0 cursor-default items-center gap-1.5 rounded-md px-1.5 py-1 text-xs tabular-nums"
            aria-label={cupo.detalle}
          >
            <span class="block h-1 w-8 overflow-hidden rounded-full bg-(--muted)" aria-hidden="true">
              <span class="block h-full rounded-full {colorDelCupo}" style="width: {Math.max(cupo.porcentaje, 4)}%"
              ></span>
            </span>
            {cupo.porcentaje}%
          </span>
        </Trigger>
        <Content side="bottom">
          <p class="text-xs">{cupo.detalle}</p>
        </Content>
      </Tooltip>
    </Provider>
  {/if}

  <div class="flex shrink-0 items-center gap-1.5">
    <IconButton
      onclick={onNewChat}
      disabled={isNewChatDisabled}
      variant="outline"
      size="icon-xs"
      tooltip={$t('ai_assistant.new_chat')}
    >
      <PlusIcon size={16} />
    </IconButton>

    <Popover.Root bind:open={historyPopoverOpen}>
      <Popover.Trigger>
        {#snippet child({ props })}
          <Button
            variant="outline"
            size="icon-xs"
            {...props}
            aria-label={$t('ai_assistant.chat_history')}
            title={$t('ai_assistant.chat_history')}
          >
            <HistoryIcon size={16} />
          </Button>
        {/snippet}
      </Popover.Trigger>
      <Popover.Content class="ui:p-0! w-72" align="center">
        <ChatHistoryPopover
          {conversations}
          {activeConversationId}
          onLoad={handleLoadConversation}
          onDelete={onDeleteConversation}
        />
      </Popover.Content>
    </Popover.Root>

    <IconButton onclick={closeAiAssistant} variant="outline" size="icon-xs">
      <XIcon size={16} />
    </IconButton>
  </div>
</div>
