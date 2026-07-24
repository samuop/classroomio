<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { t } from '$lib/utils/functions/translations';
  import { Button } from '@cio/ui/base/button';
  import { Input } from '@cio/ui/base/input';
  import { Textarea } from '@cio/ui/base/textarea';
  import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
  import SparklesIcon from '@lucide/svelte/icons/sparkles';
  import FileTextIcon from '@lucide/svelte/icons/file-text';
  import UploadCloudIcon from '@lucide/svelte/icons/upload-cloud';
  import GlobeIcon from '@lucide/svelte/icons/globe';
  import XIcon from '@lucide/svelte/icons/x';
  import PlusIcon from '@lucide/svelte/icons/plus';
  import { aiAssistantApi } from '$features/ai-assistant/api/ai-assistant.svelte';
  import { courseApi } from '$features/course/api';
  import {
    setInitialChatPrompt,
    setInitialChatDocumentIds
  } from '$features/ai-assistant/utils/store';
  import { MAX_AGENT_DOCUMENT_SIZE } from '@cio/ai-assistant';
  import type { TCourseType } from '@cio/db/types';

  const EXAMPLE_PROMPT_KEYS = [
    'course.creator.examples.sales_onboarding',
    'course.creator.examples.excel_basics',
    'course.creator.examples.customer_support',
    'course.creator.examples.product_demo'
  ];

  const ACCEPT =
    '.pdf,.docx,.pptx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation';
  const MAX_FILE_SIZE = MAX_AGENT_DOCUMENT_SIZE;
  /** Backend cap: MAX_DOCUMENTS_PER_CONVERSATION (ai_chat_document). */
  const MAX_DOCS = 10;

  type UploadedDoc = { id: string; name: string };

  let description = $state('');
  let docUrls = $state<string[]>(['']);
  let uploadedDocs = $state<UploadedDoc[]>([]);
  let uploadingCount = $state(0);
  let uploadError = $state('');
  let isDragging = $state(false);
  let creating = $state(false);

  let fileInputEl: HTMLInputElement | undefined = $state();

  const canBuild = $derived(description.trim().length > 0 && uploadingCount === 0 && !creating);
  const atDocLimit = $derived(uploadedDocs.length >= MAX_DOCS);

  function applyExample(text: string) {
    description = description.trim() ? `${description.trim()}\n${text}` : text;
  }

  function handlePickFiles() {
    uploadError = '';
    fileInputEl?.click();
  }

  async function uploadFiles(files: File[]) {
    uploadError = '';

    for (const file of files) {
      if (uploadedDocs.length + uploadingCount >= MAX_DOCS) {
        uploadError = t.get('course.creator.guide.source.too_many', { max: MAX_DOCS });
        break;
      }

      if (file.size > MAX_FILE_SIZE) {
        uploadError = t.get('course.creator.guide.source.too_large', { name: file.name });
        continue;
      }

      uploadingCount += 1;
      const result = await aiAssistantApi.uploadDraftDocument(file);
      uploadingCount -= 1;

      if (result) {
        uploadedDocs = [...uploadedDocs, { id: result.documentId, name: result.fileName }];
      } else {
        uploadError = t.get('course.creator.guide.source.upload_failed', { name: file.name });
      }
    }
  }

  async function handleFileChange(event: Event) {
    const input = event.target as HTMLInputElement;
    const files = input.files ? Array.from(input.files) : [];
    input.value = '';
    await uploadFiles(files);
  }

  function handleDragOver(event: DragEvent) {
    event.preventDefault();
    isDragging = true;
  }

  function handleDragLeave(event: DragEvent) {
    event.preventDefault();
    isDragging = false;
  }

  async function handleDrop(event: DragEvent) {
    event.preventDefault();
    isDragging = false;
    const files = event.dataTransfer?.files ? Array.from(event.dataTransfer.files) : [];
    if (files.length > 0) await uploadFiles(files);
  }

  function removeDoc(id: string) {
    uploadedDocs = uploadedDocs.filter((d) => d.id !== id);
  }

  function addUrlField() {
    docUrls = [...docUrls, ''];
  }

  function removeUrlField(index: number) {
    docUrls = docUrls.filter((_, i) => i !== index);
    if (docUrls.length === 0) docUrls = [''];
  }

  /** Natural-language handoff so the agent picks up the build directly. */
  function buildHandoffPrompt(): string {
    const lines: string[] = [description.trim()];
    const cleanUrls = docUrls.map((u) => u.trim()).filter(Boolean);

    if (cleanUrls.length > 0) {
      lines.push('');
      lines.push(`${t.get('course.creator.guide.handoff.sources')}: ${cleanUrls.join(', ')}`);
      lines.push(t.get('course.creator.guide.handoff.research_hint'));
    }

    if (uploadedDocs.length > 0) {
      lines.push('');
      lines.push(
        `${t.get('course.creator.guide.handoff.documents')}: ${uploadedDocs.map((d) => d.name).join(', ')}`
      );
    }

    return lines.join('\n');
  }

  async function handleBuild() {
    if (!canBuild) return;
    creating = true;

    const meta = await aiAssistantApi.generateCourseMeta(description.trim().slice(0, 500));
    const title = meta?.title ?? (description.trim().slice(0, 80) || t.get('course.creator.untitled_course'));
    const courseDescription = meta?.description ?? description.trim().slice(0, 150);

    setInitialChatPrompt(buildHandoffPrompt());

    if (uploadedDocs.length > 0) {
      setInitialChatDocumentIds(uploadedDocs.map((d) => d.id));
    }

    await courseApi.create({ title, description: courseDescription, type: 'SELF_PACED' as TCourseType }, (courseId) => {
      goto(resolve(`/courses/${courseId}/lessons`, {}));
    });
  }
</script>

{#if creating}
  <div class="flex min-h-[80vh] flex-col items-center justify-center gap-3 px-4 text-center">
    <LoaderCircleIcon class="ui:text-primary h-8 w-8 animate-spin" />
    <h1 class="text-xl font-semibold">{$t('course.creator.wizard.creating.heading')}</h1>
    <p class="ui:text-muted-foreground text-sm">{$t('course.creator.wizard.creating.subtext')}</p>
  </div>
{:else}
  <div class="mx-auto flex min-h-[85vh] w-full max-w-2xl flex-col justify-center px-4 py-10">
    <div class="mb-8 text-center">
      <div class="ui:bg-primary/10 ui:text-primary mx-auto mb-4 flex size-12 items-center justify-center rounded-2xl">
        <SparklesIcon class="size-7" />
      </div>
      <h1 class="mb-1 text-2xl font-semibold">{$t('course.creator.guide.title')}</h1>
      <p class="ui:text-muted-foreground text-sm">{$t('course.creator.guide.subtitle')}</p>
    </div>

    <input bind:this={fileInputEl} type="file" accept={ACCEPT} multiple class="hidden" onchange={handleFileChange} />

    <div class="flex flex-col gap-5">
      <!-- Describe the course -->
      <div class="flex flex-col gap-2">
        <Textarea
          bind:value={description}
          placeholder={$t('course.creator.guide.describe_placeholder')}
          rows={5}
        />
        <div class="flex flex-wrap gap-2">
          {#each EXAMPLE_PROMPT_KEYS as exampleKey (exampleKey)}
            <button
              type="button"
              class="ui:border ui:bg-card ui:text-muted-foreground hover:ui:text-foreground hover:ui:border-primary rounded-full px-3 py-1 text-xs transition-colors"
              onclick={() => applyExample(t.get(exampleKey))}
            >
              {$t(exampleKey)}
            </button>
          {/each}
        </div>
      </div>

      <!-- Drag & drop documents -->
      <div class="flex flex-col gap-2">
        <span class="text-sm font-medium">{$t('course.creator.guide.source.document_label')}</span>

        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          role="button"
          tabindex="0"
          class="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-6 text-center transition-colors {isDragging
            ? 'ui:border-primary ui:bg-primary/5'
            : 'ui:border-border hover:ui:border-primary/60'} {atDocLimit ? 'pointer-events-none opacity-50' : ''}"
          ondragover={handleDragOver}
          ondragleave={handleDragLeave}
          ondrop={handleDrop}
          onclick={handlePickFiles}
          onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && handlePickFiles()}
        >
          <UploadCloudIcon class="ui:text-muted-foreground size-6" />
          <span class="text-sm font-medium">{$t('course.creator.guide.source.dropzone')}</span>
          <span class="ui:text-muted-foreground text-xs">{$t('course.creator.guide.source.document_hint')}</span>
        </div>

        {#if uploadedDocs.length > 0 || uploadingCount > 0}
          <div class="flex flex-col gap-1.5">
            {#each uploadedDocs as doc (doc.id)}
              <div class="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
                <FileTextIcon class="ui:text-primary size-4 shrink-0" />
                <span class="min-w-0 flex-1 truncate">{doc.name}</span>
                <button
                  type="button"
                  onclick={() => removeDoc(doc.id)}
                  aria-label="remove"
                  class="ui:text-muted-foreground hover:ui:text-foreground"
                >
                  <XIcon class="size-4" />
                </button>
              </div>
            {/each}
            {#each Array(uploadingCount) as _, i (i)}
              <div class="ui:text-muted-foreground flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
                <LoaderCircleIcon class="size-4 shrink-0 animate-spin" />
                <span>{$t('course.creator.guide.source.uploading')}</span>
              </div>
            {/each}
          </div>
        {/if}

        {#if uploadError}
          <p class="text-xs text-red-500">{uploadError}</p>
        {/if}
        {#if uploadedDocs.length > 0}
          <p class="ui:text-muted-foreground text-xs">
            {$t('course.creator.guide.source.count', { count: uploadedDocs.length, max: MAX_DOCS })}
          </p>
        {/if}
      </div>

      <!-- Web page URLs -->
      <div class="flex flex-col gap-2">
        <span class="text-sm font-medium">{$t('course.creator.guide.source.url_label')}</span>
        <p class="ui:text-muted-foreground -mt-1 text-xs">{$t('course.creator.guide.source.url_hint')}</p>
        {#each docUrls as _, index (index)}
          <div class="flex items-center gap-2">
            <GlobeIcon class="ui:text-muted-foreground size-4 shrink-0" />
            <Input bind:value={docUrls[index]} type="url" placeholder={$t('course.creator.guide.source.url_placeholder')} />
            {#if docUrls.length > 1}
              <button
                type="button"
                onclick={() => removeUrlField(index)}
                aria-label="remove url"
                class="ui:text-muted-foreground hover:ui:text-foreground"
              >
                <XIcon class="size-4" />
              </button>
            {/if}
          </div>
        {/each}
        <button
          type="button"
          class="ui:text-primary flex w-fit items-center gap-1 text-xs hover:underline"
          onclick={addUrlField}
        >
          <PlusIcon class="size-3" />
          {$t('course.creator.guide.source.add_url')}
        </button>
      </div>
    </div>

    <!-- Build -->
    <div class="mt-8 flex justify-end">
      <Button onclick={handleBuild} disabled={!canBuild} class="gap-2">
        <SparklesIcon class="size-4" />
        {$t('course.creator.guide.build_button')}
      </Button>
    </div>
  </div>
{/if}
