<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { t } from '$lib/utils/functions/translations';
  import { Button } from '@cio/ui/base/button';
  import { Input } from '@cio/ui/base/input';
  import { Switch } from '@cio/ui/base/switch';
  import { Textarea } from '@cio/ui/base/textarea';
  import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
  import SparklesIcon from '@lucide/svelte/icons/sparkles';
  import FileTextIcon from '@lucide/svelte/icons/file-text';
  import UploadCloudIcon from '@lucide/svelte/icons/upload-cloud';
  import GlobeIcon from '@lucide/svelte/icons/globe';
  import SearchIcon from '@lucide/svelte/icons/search';
  import XIcon from '@lucide/svelte/icons/x';
  import PlusIcon from '@lucide/svelte/icons/plus';
  import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
  import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';
  import { aiAssistantApi } from '$features/ai-assistant/api/ai-assistant.svelte';
  import { courseApi } from '$features/course/api';
  import { setInitialChatPrompt, setInitialChatDocumentIds } from '$features/ai-assistant/utils/store';
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
  type ResearchDepth = 'quick' | 'normal' | 'deep';

  const RESEARCH_DEPTHS: { value: ResearchDepth; labelKey: string }[] = [
    { value: 'quick', labelKey: 'course.creator.guide.research.depth_quick' },
    { value: 'normal', labelKey: 'course.creator.guide.research.depth_normal' },
    { value: 'deep', labelKey: 'course.creator.guide.research.depth_deep' }
  ];

  /**
   * The questions the agent would otherwise stop and ask for.
   *
   * The teacher prompt runs `ask_discovery_questions` unless audience, outcome
   * AND scope are all already stated. Asking them here means the handoff arrives
   * complete and the agent goes straight to proposing a plan, instead of
   * dropping the teacher into a chat that immediately asks four questions.
   */
  const MODALITIES: { value: TCourseType; labelKey: string }[] = [
    { value: 'SELF_PACED' as TCourseType, labelKey: 'course.creator.guide.audience.modality_self_paced' },
    { value: 'LIVE_CLASS' as TCourseType, labelKey: 'course.creator.guide.audience.modality_live' }
  ];

  const LEVELS = [
    { value: 'intro', labelKey: 'course.creator.guide.audience.level_intro' },
    { value: 'intermediate', labelKey: 'course.creator.guide.audience.level_intermediate' },
    { value: 'advanced', labelKey: 'course.creator.guide.audience.level_advanced' }
  ];

  let step = $state<1 | 2>(1);

  let description = $state('');
  let docUrls = $state<string[]>(['']);
  let uploadedDocs = $state<UploadedDoc[]>([]);
  let uploadingCount = $state(0);
  let uploadError = $state('');
  let isDragging = $state(false);
  let creating = $state(false);

  let researchEnabled = $state(false);
  let researchTopic = $state('');
  let researchDepth = $state<ResearchDepth>('normal');
  let researching = $state(false);
  let researchError = $state('');
  let researchedDocs = $state<UploadedDoc[]>([]);

  let audience = $state('');
  let outcome = $state('');
  let modality = $state<TCourseType>('SELF_PACED' as TCourseType);
  let level = $state('intro');

  let fileInputEl: HTMLInputElement | undefined = $state();

  /**
   * What actually gets searched. The description is a paragraph written for a
   * human — searching it whole is how a course on colorimetry came back with
   * listicles about phone apps. The topic defaults to the description so the
   * simple case stays one field, but it is editable, and it is the only thing
   * the search sees.
   */
  const effectiveTopic = $derived(researchTopic.trim() || description.trim());

  const canContinue = $derived(description.trim().length > 0 && uploadingCount === 0);
  const canBuild = $derived(canContinue && audience.trim().length > 0 && !creating && !researching);
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

    lines.push('');
    lines.push(`${t.get('course.creator.guide.handoff.audience')}: ${audience.trim()}`);

    if (outcome.trim()) {
      lines.push(`${t.get('course.creator.guide.handoff.outcome')}: ${outcome.trim()}`);
    }

    lines.push(
      `${t.get('course.creator.guide.handoff.modality')}: ` +
        `${t.get(MODALITIES.find((m) => m.value === modality)?.labelKey ?? '')}, ` +
        `${t.get(LEVELS.find((l) => l.value === level)?.labelKey ?? '')}`
    );

    if (cleanUrls.length > 0) {
      lines.push('');
      lines.push(`${t.get('course.creator.guide.handoff.sources')}: ${cleanUrls.join(', ')}`);
      lines.push(t.get('course.creator.guide.handoff.research_hint'));
    }

    const attached = [...uploadedDocs, ...researchedDocs];

    if (attached.length > 0) {
      lines.push('');
      lines.push(`${t.get('course.creator.guide.handoff.documents')}: ${attached.map((d) => d.name).join(', ')}`);
    }

    if (researchedDocs.length > 0) {
      lines.push(t.get('course.creator.guide.handoff.researched_hint', { count: researchedDocs.length }));
    }

    return lines.join('\n');
  }

  /**
   * Research runs BEFORE the course is created, and its pages are attached as
   * sources exactly like the uploaded PDFs — so the agent plans from the material
   * instead of being told to go find some. That ordering is the whole point: a
   * prompt asking the model to research is a request it can skip, while a source
   * already sitting in the pack is one it cannot.
   */
  async function runResearch(): Promise<boolean> {
    researchError = '';
    researching = true;

    const outcomeResult = await aiAssistantApi.research(effectiveTopic.slice(0, 500), researchDepth);

    researching = false;

    if (!outcomeResult) {
      researchError = aiAssistantApi.error || t.get('course.creator.guide.research.failed');

      return false;
    }

    researchedDocs = outcomeResult.sources.map((s) => ({ id: s.documentId, name: s.title }));

    if (researchedDocs.length === 0) {
      researchError = t.get('course.creator.guide.research.empty');

      return false;
    }

    return true;
  }

  async function handleBuild() {
    if (!canBuild) return;

    // A failed or empty research stops the build rather than quietly creating a
    // course without the material the teacher asked for.
    if (researchEnabled && researchedDocs.length === 0 && !(await runResearch())) return;

    creating = true;

    const meta = await aiAssistantApi.generateCourseMeta(description.trim().slice(0, 500));
    const title = meta?.title ?? (description.trim().slice(0, 80) || t.get('course.creator.untitled_course'));
    const courseDescription = meta?.description ?? description.trim().slice(0, 150);

    setInitialChatPrompt(buildHandoffPrompt());

    const attachedIds = [...uploadedDocs, ...researchedDocs].map((d) => d.id);

    if (attachedIds.length > 0) {
      setInitialChatDocumentIds(attachedIds);
    }

    await courseApi.create({ title, description: courseDescription, type: modality }, (courseId) => {
      goto(resolve(`/courses/${courseId}/lessons`, {}));
    });
  }
</script>

{#snippet chip(label: string, active: boolean, onSelect: () => void)}
  <button
    type="button"
    class="rounded-full border px-3 py-1 text-xs transition-colors {active
      ? 'ui:border-primary ui:bg-primary/10 ui:text-primary'
      : 'ui:text-muted-foreground hover:ui:border-primary/60'}"
    onclick={onSelect}
  >
    {label}
  </button>
{/snippet}

{#if researching}
  <div class="flex min-h-[80vh] flex-col items-center justify-center gap-3 px-4 text-center">
    <LoaderCircleIcon class="ui:text-primary h-8 w-8 animate-spin" />
    <h1 class="text-xl font-semibold">{$t('course.creator.guide.research.working_heading')}</h1>
    <p class="ui:text-muted-foreground max-w-md text-sm">
      {$t('course.creator.guide.research.working_subtext')}
    </p>
  </div>
{:else if creating}
  <div class="flex min-h-[80vh] flex-col items-center justify-center gap-3 px-4 text-center">
    <LoaderCircleIcon class="ui:text-primary h-8 w-8 animate-spin" />
    <h1 class="text-xl font-semibold">{$t('course.creator.wizard.creating.heading')}</h1>
    <p class="ui:text-muted-foreground text-sm">{$t('course.creator.wizard.creating.subtext')}</p>
  </div>
{:else}
  <div class="mx-auto flex w-full max-w-3xl flex-col px-4 py-6">
    <div class="mb-4 text-center">
      <h1 class="text-xl font-semibold">{$t('course.creator.guide.title')}</h1>
      <p class="ui:text-muted-foreground text-xs">
        {$t('course.creator.guide.step_of', { current: step, total: 2 })} ·
        {step === 1 ? $t('course.creator.guide.step_1_name') : $t('course.creator.guide.step_2_name')}
      </p>
    </div>

    <input bind:this={fileInputEl} type="file" accept={ACCEPT} multiple class="hidden" onchange={handleFileChange} />

    {#if step === 1}
      <div class="flex flex-col gap-4">
        <div class="flex flex-col gap-2">
          <Textarea
            bind:value={description}
            placeholder={$t('course.creator.guide.describe_placeholder')}
            rows={3}
          />
          <div class="flex flex-wrap gap-1.5">
            {#each EXAMPLE_PROMPT_KEYS as exampleKey (exampleKey)}
              <button
                type="button"
                class="ui:border ui:bg-card ui:text-muted-foreground hover:ui:text-foreground hover:ui:border-primary rounded-full px-2.5 py-0.5 text-xs transition-colors"
                onclick={() => applyExample(t.get(exampleKey))}
              >
                {$t(exampleKey)}
              </button>
            {/each}
          </div>
        </div>

        <!-- Research -->
        <div class="flex flex-col gap-2 rounded-xl border p-3">
          <div class="flex items-start gap-2">
            <SearchIcon class="ui:text-primary mt-0.5 size-4 shrink-0" />
            <div class="min-w-0 flex-1">
              <span class="text-sm font-medium">{$t('course.creator.guide.research.label')}</span>
              <p class="ui:text-muted-foreground text-xs">{$t('course.creator.guide.research.hint')}</p>
            </div>
            <Switch bind:checked={researchEnabled} aria-label={$t('course.creator.guide.research.label')} />
          </div>

          {#if researchEnabled}
            <div class="flex flex-col gap-2 pl-6">
              <Input
                type="text"
                bind:value={researchTopic}
                placeholder={description.trim()
                  ? $t('course.creator.guide.research.topic_placeholder_from_description')
                  : $t('course.creator.guide.research.topic_placeholder')}
              />
              <div class="flex flex-wrap gap-2">
                {#each RESEARCH_DEPTHS as option (option.value)}
                  {@render chip($t(option.labelKey), researchDepth === option.value, () => (researchDepth = option.value))}
                {/each}
              </div>
              {#if researchedDocs.length > 0}
                <p class="ui:text-muted-foreground text-xs">
                  {$t('course.creator.guide.research.found', { count: researchedDocs.length })}
                </p>
              {/if}
              {#if researchError}
                <p class="text-xs text-red-500">{researchError}</p>
              {/if}
            </div>
          {/if}
        </div>

        <!-- Material: files and links side by side so the step fits one screen -->
        <div class="grid gap-3 md:grid-cols-2">
          <div class="flex flex-col gap-1.5">
            <span class="text-xs font-medium">{$t('course.creator.guide.source.document_label')}</span>
            <div
              role="button"
              tabindex="0"
              class="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed px-3 py-4 text-center transition-colors {isDragging
                ? 'ui:border-primary ui:bg-primary/5'
                : 'ui:border-border hover:ui:border-primary/60'} {atDocLimit ? 'pointer-events-none opacity-50' : ''}"
              ondragover={handleDragOver}
              ondragleave={handleDragLeave}
              ondrop={handleDrop}
              onclick={handlePickFiles}
              onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && handlePickFiles()}
            >
              <UploadCloudIcon class="ui:text-muted-foreground size-5" />
              <span class="text-xs font-medium">{$t('course.creator.guide.source.dropzone')}</span>
              <span class="ui:text-muted-foreground text-[11px]">
                {$t('course.creator.guide.source.document_hint')}
              </span>
            </div>

            {#if uploadedDocs.length > 0 || uploadingCount > 0}
              <div class="flex flex-col gap-1">
                {#each uploadedDocs as doc (doc.id)}
                  <div class="flex items-center gap-2 rounded-lg border px-2 py-1 text-xs">
                    <FileTextIcon class="ui:text-primary size-3.5 shrink-0" />
                    <span class="min-w-0 flex-1 truncate">{doc.name}</span>
                    <button
                      type="button"
                      onclick={() => removeDoc(doc.id)}
                      aria-label="remove"
                      class="ui:text-muted-foreground hover:ui:text-foreground"
                    >
                      <XIcon class="size-3.5" />
                    </button>
                  </div>
                {/each}
                {#each Array(uploadingCount) as _, i (i)}
                  <div class="ui:text-muted-foreground flex items-center gap-2 rounded-lg border px-2 py-1 text-xs">
                    <LoaderCircleIcon class="size-3.5 shrink-0 animate-spin" />
                    <span>{$t('course.creator.guide.source.uploading')}</span>
                  </div>
                {/each}
              </div>
            {/if}

            {#if uploadError}
              <p class="text-xs text-red-500">{uploadError}</p>
            {/if}
          </div>

          <div class="flex flex-col gap-1.5">
            <span class="text-xs font-medium">{$t('course.creator.guide.source.url_label')}</span>
            {#each docUrls as _, index (index)}
              <div class="flex items-center gap-1.5">
                <GlobeIcon class="ui:text-muted-foreground size-3.5 shrink-0" />
                <Input
                  bind:value={docUrls[index]}
                  type="url"
                  placeholder={$t('course.creator.guide.source.url_placeholder')}
                />
                {#if docUrls.length > 1}
                  <button
                    type="button"
                    onclick={() => removeUrlField(index)}
                    aria-label="remove url"
                    class="ui:text-muted-foreground hover:ui:text-foreground"
                  >
                    <XIcon class="size-3.5" />
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
      </div>

      <div class="mt-5 flex justify-end">
        <Button onclick={() => (step = 2)} disabled={!canContinue} class="gap-2">
          {$t('course.creator.guide.continue_button')}
          <ArrowRightIcon class="size-4" />
        </Button>
      </div>
    {:else}
      <div class="flex flex-col gap-4">
        <div class="flex flex-col gap-1.5">
          <span class="text-sm font-medium">{$t('course.creator.guide.audience.who_label')}</span>
          <Input type="text" bind:value={audience} placeholder={$t('course.creator.guide.audience.who_placeholder')} />
        </div>

        <div class="flex flex-col gap-1.5">
          <span class="text-sm font-medium">{$t('course.creator.guide.audience.outcome_label')}</span>
          <Textarea bind:value={outcome} rows={3} placeholder={$t('course.creator.guide.audience.outcome_placeholder')} />
        </div>

        <div class="grid gap-4 md:grid-cols-2">
          <div class="flex flex-col gap-1.5">
            <span class="text-sm font-medium">{$t('course.creator.guide.audience.modality_label')}</span>
            <div class="flex flex-wrap gap-2">
              {#each MODALITIES as option (option.value)}
                {@render chip($t(option.labelKey), modality === option.value, () => (modality = option.value))}
              {/each}
            </div>
          </div>

          <div class="flex flex-col gap-1.5">
            <span class="text-sm font-medium">{$t('course.creator.guide.audience.level_label')}</span>
            <div class="flex flex-wrap gap-2">
              {#each LEVELS as option (option.value)}
                {@render chip($t(option.labelKey), level === option.value, () => (level = option.value))}
              {/each}
            </div>
          </div>
        </div>

        {#if researchError}
          <p class="text-xs text-red-500">{researchError}</p>
        {/if}
      </div>

      <div class="mt-5 flex items-center justify-between">
        <Button variant="ghost" onclick={() => (step = 1)} class="gap-2">
          <ArrowLeftIcon class="size-4" />
          {$t('course.creator.guide.back_button')}
        </Button>
        <Button onclick={handleBuild} disabled={!canBuild} class="gap-2">
          <SparklesIcon class="size-4" />
          {$t('course.creator.guide.build_button')}
        </Button>
      </div>
    {/if}
  </div>
{/if}
