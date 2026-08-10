<script lang="ts">
  import type { CourseSource, DocumentCacheStatus } from '../utils/types';
  import { Button } from '@cio/ui/base/button';
  import { t } from '$lib/utils/functions/translations';
  import * as Dialog from '@cio/ui/base/dialog';
  import FileTextIcon from '@lucide/svelte/icons/file-text';
  import TrashIcon from '@lucide/svelte/icons/trash';
  import LoaderIcon from '@lucide/svelte/icons/loader';
  import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
  import ZapIcon from '@lucide/svelte/icons/zap';

  let {
    source,
    isDeleting = false,
    isRefreshing = false,
    cacheStatus,
    onDelete,
    onRefresh
  }: {
    source: CourseSource;
    isDeleting?: boolean;
    isRefreshing?: boolean;
    cacheStatus?: DocumentCacheStatus;
    onDelete: () => void | Promise<void>;
    onRefresh: () => void | Promise<void>;
  } = $props();

  let confirmOpen = $state(false);

  const mimeLabel = $derived.by(() => {
    if (source.mimeType === 'application/pdf') return t.get('course.sources.meta_pdf');
    if (
      source.mimeType ===
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    )
      return t.get('course.sources.meta_docx');
    if (
      source.mimeType ===
      'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    )
      return t.get('course.sources.meta_pptx');
    return source.mimeType;
  });

  const createdAtLabel = $derived.by(() => {
    try {
      return new Date(source.createdAt).toLocaleDateString();
    } catch {
      return '';
    }
  });

  /**
   * States an observed fact, not a forecast.
   *
   * This used to read "Cache active · ~N min remaining", derived from a TTL we
   * invented. The provider exposes no cache-status endpoint, so that number was a
   * guess about someone else's eviction policy — and it guessed short, showing
   * "not cached" while production data had the provider serving reads 20 minutes
   * apart. What we can actually prove is when it last served cached tokens and
   * how many, so that is what the card says.
   *
   * Gemini used to keep a countdown, because back then its cache was a
   * `cachedContents` lease we created and renewed. We no longer create one (it
   * cannot coexist with a request that carries tools — see document-cache.ts),
   * so there is no lease to count down and both providers report the same kind
   * of fact: a read that was billed, and when.
   */
  const cacheLabel = $derived.by(() => {
    if (!cacheStatus?.cached) return t.get('course.sources.cache_never_read');

    if (cacheStatus.observedSecondsAgo === null) return t.get('course.sources.cache_never_read');

    const minutesAgo = Math.floor(cacheStatus.observedSecondsAgo / 60);
    const tokens = (cacheStatus.lastCacheReadTokens ?? 0).toLocaleString();

    return minutesAgo < 1
      ? t.get('course.sources.cache_read_just_now', { tokens })
      : t.get('course.sources.cache_read_ago', { minutes: minutesAgo, tokens });
  });

  async function handleConfirmDelete() {
    confirmOpen = false;
    await onDelete();
  }
</script>

<div
  class="flex flex-col gap-3 rounded-lg border p-4 transition-colors hover:ui:bg-muted/30"
>
  <div class="flex items-start justify-between gap-2">
    <div class="flex min-w-0 items-start gap-2">
      <FileTextIcon size={18} class="ui:text-primary mt-0.5 shrink-0" />
      <div class="flex min-w-0 flex-col">
        <span class="truncate text-sm font-medium" title={source.fileName}>
          {source.fileName}
        </span>
        <!-- One line, truncated: it used to wrap to one word per line in a narrow card. -->
        <span class="ui:text-muted-foreground truncate text-xs">
          {mimeLabel}
          {#if source.pageCount}
            · {t.get('course.sources.meta_pages', { count: source.pageCount })}
          {/if}
          {#if source.wordCount}
            · {t.get('course.sources.meta_words', { count: source.wordCount })}
          {/if}
        </span>
      </div>
    </div>

    <div class="flex shrink-0 items-center gap-1">
      <Button
        variant="ghost"
        size="sm"
        disabled={isRefreshing}
        onclick={onRefresh}
        aria-label={t.get('course.sources.refresh_cache_aria')}
        class="ui:text-muted-foreground hover:ui:text-foreground"
      >
        {#if isRefreshing}
          <LoaderIcon size={14} class="animate-spin" />
        {:else}
          <RefreshCwIcon size={14} />
        {/if}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        disabled={isDeleting}
        onclick={() => (confirmOpen = true)}
        aria-label={t.get('course.sources.delete_confirm_yes')}
        class="ui:text-muted-foreground hover:ui:text-destructive"
      >
        {#if isDeleting}
          <LoaderIcon size={14} class="animate-spin" />
        {:else}
          <TrashIcon size={14} />
        {/if}
      </Button>
    </div>
  </div>

  {#if cacheLabel}
    <div class="flex items-center gap-1.5 text-xs">
      <ZapIcon
        size={11}
        class={cacheStatus?.cached ? 'ui:text-primary' : 'ui:text-muted-foreground'}
      />
      <span class={cacheStatus?.cached ? 'ui:text-primary' : 'ui:text-muted-foreground'}>
        {cacheLabel}
      </span>
    </div>
  {/if}

  {#if createdAtLabel}
    <div class="ui:text-muted-foreground text-xs">
      {createdAtLabel}
    </div>
  {/if}
</div>

<Dialog.Root bind:open={confirmOpen}>
  <Dialog.Content class="w-96">
    <Dialog.Header>
      <Dialog.Title>{$t('course.sources.delete_confirm_title')}</Dialog.Title>
      <Dialog.Description>
        {$t('course.sources.delete_confirm_body', { fileName: source.fileName })}
      </Dialog.Description>
    </Dialog.Header>
    <Dialog.Footer class="ui:gap-2">
      <Button variant="outline" onclick={() => (confirmOpen = false)}>
        {$t('course.sources.delete_confirm_no')}
      </Button>
      <Button variant="destructive" onclick={handleConfirmDelete}>
        {$t('course.sources.delete_confirm_yes')}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>