<script lang="ts">
  import type { CourseSource, DocumentCacheStatus } from '../utils/types';
  import { Button } from '@cio/ui/base/button';
  import { t } from '$lib/utils/functions/translations';
  import * as Dialog from '@cio/ui/base/dialog';
  import FileTextIcon from '@lucide/svelte/icons/file-text';
  import TrashIcon from '@lucide/svelte/icons/trash';
  import LoaderIcon from '@lucide/svelte/icons/loader';
  import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
  import CheckIcon from '@lucide/svelte/icons/check';

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
    if (source.mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
      return t.get('course.sources.meta_docx');
    if (source.mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation')
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
   * Que la fuente ya fue leída. Nada más.
   *
   * Antes esto contaba el mecanismo: "Leída de caché hace 3 min · 110.464
   * fichas". Eso es cómo funciona la plataforma por dentro — que exista una
   * caché de contexto, cuándo se evictó, cuánto costó— y no algo sobre lo que
   * quien arma un curso pueda hacer nada. Lo único que necesita saber es si el
   * asistente ya tiene el material.
   *
   * Sin leer no se muestra nada: una fuente recién subida no tiene marca, y esa
   * ausencia ya dice lo suyo sin agregar una línea que explicar.
   */
  const leida = $derived(Boolean(cacheStatus?.cached && cacheStatus.observedSecondsAgo !== null));

  async function handleConfirmDelete() {
    confirmOpen = false;
    await onDelete();
  }
</script>

<div class="hover:ui:bg-muted/30 flex flex-col gap-3 rounded-lg border p-4 transition-colors">
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

  {#if leida}
    <div class="ui:text-primary flex items-center gap-1.5 text-xs">
      <CheckIcon size={11} />
      <span>{t.get('course.sources.read_mark')}</span>
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
