<script lang="ts">
  import { Button } from '@cio/ui/base/button';
  import { Input } from '@cio/ui/base/input';
  import * as Dialog from '@cio/ui/base/dialog';
  import { t } from '$lib/utils/functions/translations';
  import LoaderIcon from '@lucide/svelte/icons/loader';
  import UploadCloudIcon from '@lucide/svelte/icons/upload-cloud';
  import FileTextIcon from '@lucide/svelte/icons/file-text';
  import { aiAssistantApi } from '../api/ai-assistant.svelte';
  import { sourcesApi } from '../api/sources.svelte';
  import { MAX_AGENT_DOCUMENT_SIZE } from '@cio/ai-assistant';

  let {
    open = $bindable(false),
    courseId,
    onUploaded
  }: {
    open: boolean;
    courseId: string;
    onUploaded: (documentId: string) => void | Promise<void>;
  } = $props();

  let fileInputRef: HTMLInputElement | null = $state(null);
  let selectedFile: File | null = $state(null);
  let isUploading = $state(false);
  let dragOver = $state(false);
  let localError = $state<string | null>(null);

  /**
   * A web page is a source too. It used to reach the agent only as a
   * `fetch_documentation_url` tool result inside the transcript — and build mode
   * discards the transcript, so the page was gone exactly when the course was
   * written from it. Added here it is stored like a PDF and rides in the cached
   * source pack.
   */
  let mode = $state<'file' | 'url'>('file');
  let urlValue = $state('');
  let isAddingUrl = $state(false);

  const canSubmit = $derived(mode === 'file' ? !!selectedFile : urlValue.trim().length > 0);
  const isBusy = $derived(isUploading || isAddingUrl);

  const ALLOWED_MIME_TYPES = [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  ] as const;

  const MAX_FILE_SIZE = MAX_AGENT_DOCUMENT_SIZE;
  const MAX_FILE_SIZE_MB = Math.round((MAX_FILE_SIZE / (1024 * 1024)) * 10) / 10;

  function resetState() {
    selectedFile = null;
    if (fileInputRef) fileInputRef.value = '';
    localError = null;
    isUploading = false;
    urlValue = '';
    isAddingUrl = false;
    mode = 'file';
  }

  function handleOpenChange(isOpen: boolean) {
    open = isOpen;
    if (!isOpen) resetState();
  }

  function validateFile(file: File): string | null {
    if (!(ALLOWED_MIME_TYPES as readonly string[]).includes(file.type)) {
      return 'unsupported_file_type';
    }
    if (file.size > MAX_FILE_SIZE) {
      return 'file_too_large';
    }
    return null;
  }

  function handleFileSelect(file: File) {
    const err = validateFile(file);
    if (err) {
      localError = err;
      selectedFile = null;
      return;
    }
    localError = null;
    selectedFile = file;
  }

  function handleFileInput(event: Event) {
    const target = event.target as HTMLInputElement;
    const file = target.files?.[0];
    if (file) handleFileSelect(file);
  }

  function handleDrop(event: DragEvent) {
    event.preventDefault();
    dragOver = false;
    const file = event.dataTransfer?.files?.[0];
    if (file) handleFileSelect(file);
  }

  async function handleUpload() {
    if (!selectedFile || isUploading) return;

    isUploading = true;
    localError = null;

    try {
      // Reuse the existing chat upload endpoint — it now creates a hidden
      // "Course sources" conversation when conversationId is omitted (Phase 1
      // backend change). Parsed text + asset + cache handle are all written
      // there; the Sources panel just needs the documentId back.
      const result = await aiAssistantApi.uploadSourceDocument(selectedFile, courseId);
      if (result) {
        open = false;
        resetState();
        await onUploaded(result.documentId);
      } else {
        localError = 'upload_failed';
      }
    } catch (err) {
      console.error('[sources] upload failed:', err);
      localError = 'upload_failed';
    } finally {
      isUploading = false;
    }
  }

  async function handleAddUrl() {
    const url = urlValue.trim();
    if (!url || isAddingUrl) return;

    isAddingUrl = true;
    localError = null;

    try {
      const ok = await sourcesApi.addUrlSource(courseId, url);
      if (ok) {
        open = false;
        resetState();
      } else {
        localError = 'url_failed';
      }
    } catch (err) {
      console.error('[sources] add url failed:', err);
      localError = 'url_failed';
    } finally {
      isAddingUrl = false;
    }
  }

  function handleSubmit() {
    if (mode === 'file') void handleUpload();
    else void handleAddUrl();
  }
</script>

<Dialog.Root {open} onOpenChange={handleOpenChange}>
  <Dialog.Content class="w-96">
    <Dialog.Header>
      <Dialog.Title>{$t('course.sources.upload_cta')}</Dialog.Title>
      <Dialog.Description>
        {$t('course.sources.drop_zone_hint', { maxSize: MAX_FILE_SIZE_MB })}
      </Dialog.Description>
    </Dialog.Header>

    <div class="ui:bg-muted mb-3 flex gap-1 rounded-md p-1">
      <button
        type="button"
        class="flex-1 rounded px-3 py-1.5 text-xs font-medium transition-colors {mode === 'file'
          ? 'ui:bg-background shadow-sm'
          : 'ui:text-muted-foreground'}"
        onclick={() => {
          mode = 'file';
          localError = null;
        }}
      >
        {$t('course.sources.tab_file')}
      </button>
      <button
        type="button"
        class="flex-1 rounded px-3 py-1.5 text-xs font-medium transition-colors {mode === 'url'
          ? 'ui:bg-background shadow-sm'
          : 'ui:text-muted-foreground'}"
        onclick={() => {
          mode = 'url';
          localError = null;
        }}
      >
        {$t('course.sources.tab_url')}
      </button>
    </div>

    {#if mode === 'url'}
      <div class="flex flex-col gap-2">
        <Input
          type="url"
          placeholder="https://…"
          bind:value={urlValue}
          onkeydown={(e: KeyboardEvent) => {
            if (e.key === 'Enter' && canSubmit && !isBusy) handleSubmit();
          }}
        />
        <p class="ui:text-muted-foreground text-xs">
          {$t('course.sources.url_hint')}
        </p>
      </div>
    {:else}
      <div
        role="button"
        tabindex="-1"
        ondragover={(e) => {
        e.preventDefault();
        dragOver = true;
      }}
      ondragleave={() => (dragOver = false)}
      ondrop={handleDrop}
      onclick={() => fileInputRef?.click()}
        onkeydown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') fileInputRef?.click();
        }}
        class="flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed p-6 text-center transition-colors {dragOver
          ? 'border-primary ui:bg-muted/40'
          : 'ui:border-border'}"
      >
        <UploadCloudIcon size={28} class="ui:text-muted-foreground" />
        <span class="text-sm font-medium">
          {$t('course.sources.drop_zone_title')}
        </span>
        <Input
          bind:ref={fileInputRef}
          type="file"
          accept=".pdf,.docx,.pptx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation"
          onchange={handleFileInput}
          class="hidden"
        />
      </div>
    {/if}

    {#if selectedFile && mode === 'file'}
      <div class="mt-3 flex items-center gap-2 rounded border p-3 text-sm">
        <FileTextIcon size={14} class="ui:text-primary shrink-0" />
        <div class="flex min-w-0 flex-col">
          <span class="truncate font-medium" title={selectedFile.name}>
            {selectedFile.name}
          </span>
          <span class="ui:text-muted-foreground text-xs">
            {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
          </span>
        </div>
      </div>
    {/if}

    {#if localError === 'unsupported_file_type'}
      <p class="ui:text-destructive mt-2 text-xs">
        {$t('course.sources.meta_pdf')} / {$t('course.sources.meta_docx')} / {$t(
          'course.sources.meta_pptx'
        )} only
      </p>
    {:else if localError === 'file_too_large'}
      <p class="ui:text-destructive mt-2 text-xs">
        File exceeds {MAX_FILE_SIZE_MB}MB
      </p>
    {:else if localError === 'upload_failed'}
      <p class="ui:text-destructive mt-2 text-xs">{$t('course.sources.snackbar_delete_failed')}</p>
    {:else if localError === 'url_failed'}
      <p class="ui:text-destructive mt-2 text-xs">{$t('course.sources.url_failed')}</p>
    {/if}

    <Dialog.Footer class="ui:gap-2">
      <Button variant="outline" onclick={() => handleOpenChange(false)}>
        {$t('course.sources.delete_confirm_no')}
      </Button>
      <Button onclick={handleSubmit} disabled={!canSubmit || isBusy}>
        {#if isBusy}
          <LoaderIcon size={14} class="animate-spin" />
          {$t('course.sources.uploading')}
        {:else}
          {$t('course.sources.upload_cta')}
        {/if}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>