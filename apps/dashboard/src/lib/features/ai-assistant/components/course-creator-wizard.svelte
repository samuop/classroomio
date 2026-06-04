<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { t } from '$lib/utils/functions/translations';
  import { Button } from '@cio/ui/base/button';
  import { Input } from '@cio/ui/base/input';
  import { Textarea } from '@cio/ui/base/textarea';
  import * as Select from '@cio/ui/base/select';
  import CheckCircleIcon from '@lucide/svelte/icons/circle-check';
  import CircleIcon from '@lucide/svelte/icons/circle';
  import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
  import GraduationCapIcon from '@lucide/svelte/icons/graduation-cap';
  import CompassIcon from '@lucide/svelte/icons/compass';
  import AwardIcon from '@lucide/svelte/icons/award';
  import SparklesIcon from '@lucide/svelte/icons/sparkles';
  import FileTextIcon from '@lucide/svelte/icons/file-text';
  import GlobeIcon from '@lucide/svelte/icons/globe';
  import XIcon from '@lucide/svelte/icons/x';
  import PlusIcon from '@lucide/svelte/icons/plus';
  import { aiAssistantApi } from '$features/ai-assistant/api/ai-assistant.svelte';
  import { courseApi } from '$features/course/api';
  import {
    setInitialChatPrompt,
    setInitialChatTemplateId,
    setInitialChatTemplateAnswers,
    setInitialChatDocumentIds
  } from '$features/ai-assistant/utils/store';
  import { DISPLAY_BY_ID } from '$features/ai-assistant/utils/template-display';
  import type { CourseTemplateId } from '@cio/ai-assistant';
  import type { TCourseType } from '@cio/db/types';

  type CourseType = CourseTemplateId | 'from_scratch';

  const TYPE_OPTIONS: { value: CourseType; iconName: string; titleKey: string; descriptionKey: string }[] = [
    {
      value: 'product_101',
      iconName: 'GraduationCap',
      titleKey: 'course.creator.template.product_101.title',
      descriptionKey: 'course.creator.template.product_101.description'
    },
    {
      value: 'product_onboarding',
      iconName: 'Compass',
      titleKey: 'course.creator.template.product_onboarding.title',
      descriptionKey: 'course.creator.template.product_onboarding.description'
    },
    {
      value: 'expert_on_x',
      iconName: 'Award',
      titleKey: 'course.creator.template.expert_on_x.title',
      descriptionKey: 'course.creator.template.expert_on_x.description'
    },
    {
      value: 'from_scratch',
      iconName: 'Sparkles',
      titleKey: 'course.creator.wizard.type.from_scratch.title',
      descriptionKey: 'course.creator.wizard.type.from_scratch.description'
    }
  ];

  const EXAMPLE_PROMPT_KEYS = [
    'course.creator.examples.sales_onboarding',
    'course.creator.examples.excel_basics',
    'course.creator.examples.customer_support',
    'course.creator.examples.product_demo'
  ];

  const LEVEL_OPTIONS = [
    { value: 'beginner', labelKey: 'course.creator.level.beginner' },
    { value: 'intermediate', labelKey: 'course.creator.level.intermediate' },
    { value: 'advanced', labelKey: 'course.creator.level.advanced' }
  ];

  const ACCEPT =
    '.pdf,.docx,.pptx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation';
  const MAX_FILE_SIZE = 5 * 1024 * 1024;

  const TOTAL_STEPS = 4;

  let currentStep = $state(1);
  let creating = $state(false);

  // Answers
  let courseType = $state<CourseType>('from_scratch');
  let topic = $state('');
  let goal = $state('');
  let audience = $state('');
  let level = $state('beginner');
  let uploadedDoc = $state<{ id: string; name: string } | null>(null);
  let isUploading = $state(false);
  let uploadError = $state('');
  let docUrls = $state<string[]>(['']);

  let fileInputEl: HTMLInputElement | undefined = $state();

  const canProceed = $derived.by(() => {
    if (currentStep === 2) {
      return topic.trim().length > 0 && goal.trim().length > 0;
    }

    return true;
  });

  function selectedLevelLabel(): string {
    const opt = LEVEL_OPTIONS.find((o) => o.value === level);

    return opt ? t.get(opt.labelKey) : '';
  }

  function next() {
    if (currentStep < TOTAL_STEPS && canProceed) {
      currentStep += 1;
    }
  }

  function back() {
    if (currentStep > 1) {
      currentStep -= 1;
    }
  }

  function applyExample(text: string) {
    topic = text;
  }

  function handlePickFile() {
    uploadError = '';
    fileInputEl?.click();
  }

  async function handleFileChange(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';

    if (!file) return;

    if (file.size > MAX_FILE_SIZE) {
      uploadError = t.get('course.creator.wizard.source.too_large');
      return;
    }

    isUploading = true;
    uploadError = '';
    const result = await aiAssistantApi.uploadDraftDocument(file);
    isUploading = false;

    if (result) {
      uploadedDoc = { id: result.documentId, name: result.fileName };
    } else {
      uploadError = t.get('course.creator.wizard.source.upload_failed');
    }
  }

  function removeDoc() {
    uploadedDoc = null;
  }

  function addUrlField() {
    docUrls = [...docUrls, ''];
  }

  function removeUrlField(index: number) {
    docUrls = docUrls.filter((_, i) => i !== index);

    if (docUrls.length === 0) {
      docUrls = [''];
    }
  }

  /** Map wizard answers to the template's canonical field keys (best-effort). */
  function buildTemplateAnswers(): Record<string, string> {
    const cleanUrls = docUrls.map((u) => u.trim()).filter(Boolean);
    const answers: Record<string, string> = {
      audience: audience.trim(),
      outcome: goal.trim()
    };

    if (cleanUrls.length > 0) {
      answers.documentation_url = cleanUrls[0];
    }

    if (courseType === 'product_101') {
      answers.product_name = topic.trim();
      answers.product_summary = topic.trim();
      answers.depth = 'balanced';
    } else if (courseType === 'product_onboarding') {
      answers.product_name = topic.trim();
    } else if (courseType === 'expert_on_x') {
      answers.topic = topic.trim();
      answers.expertise_level = level;
    }

    return answers;
  }

  /** Locale-aware natural-language handoff prompt assembled from the answers. */
  function buildHandoffPrompt(): string {
    const lines: string[] = [];
    const typeLabel =
      courseType === 'from_scratch'
        ? t.get('course.creator.wizard.type.from_scratch.title')
        : t.get(`course.creator.template.${courseType}.title`);

    lines.push(`${t.get('course.creator.wizard.handoff.type')}: ${typeLabel}`);
    lines.push(`${t.get('course.creator.wizard.handoff.topic')}: ${topic.trim()}`);
    lines.push(`${t.get('course.creator.wizard.handoff.goal')}: ${goal.trim()}`);

    if (audience.trim()) {
      lines.push(`${t.get('course.creator.wizard.handoff.audience')}: ${audience.trim()}`);
    }

    lines.push(`${t.get('course.creator.wizard.handoff.level')}: ${selectedLevelLabel()}`);

    const cleanUrls = docUrls.map((u) => u.trim()).filter(Boolean);

    if (cleanUrls.length > 0) {
      lines.push(`${t.get('course.creator.wizard.handoff.sources')}: ${cleanUrls.join(', ')}`);
    }

    lines.push('');
    lines.push('Course type: Self-paced.');
    lines.push(t.get('course.creator.wizard.handoff.outro'));

    return lines.join('\n');
  }

  async function handleFinish() {
    creating = true;

    const meta = await aiAssistantApi.generateCourseMeta(`${topic.trim()} — ${goal.trim()}`);
    const title = meta?.title ?? (topic.trim().slice(0, 80) || t.get('course.creator.untitled_course'));
    const description = meta?.description ?? goal.trim().slice(0, 150);

    setInitialChatPrompt(buildHandoffPrompt());

    if (courseType !== 'from_scratch') {
      setInitialChatTemplateId(courseType);
      setInitialChatTemplateAnswers(buildTemplateAnswers());
    }

    if (uploadedDoc) {
      setInitialChatDocumentIds([uploadedDoc.id]);
    }

    await courseApi.create({ title, description, type: 'SELF_PACED' as TCourseType }, (courseId) => {
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
  <div class="mx-auto flex min-h-[85vh] w-full max-w-2xl flex-col px-4 py-10">
    <!-- Progress header -->
    <div class="mb-8 flex items-center justify-center gap-2">
      {#each Array(TOTAL_STEPS) as _, i (i)}
        {@const stepNum = i + 1}
        <div class="flex items-center gap-2">
          {#if stepNum < currentStep}
            <CheckCircleIcon class="h-5 w-5 text-green-500" />
          {:else if stepNum === currentStep}
            <div class="ui:bg-primary ui:text-primary-foreground flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold">
              {stepNum}
            </div>
          {:else}
            <CircleIcon class="ui:text-muted-foreground h-5 w-5" />
          {/if}
          {#if stepNum < TOTAL_STEPS}
            <span class="ui:bg-border h-px w-8"></span>
          {/if}
        </div>
      {/each}
    </div>

    <div class="flex-1">
      <!-- Step 1: Course type -->
      {#if currentStep === 1}
        <h1 class="mb-1 text-2xl font-semibold">{$t('course.creator.wizard.steps.type.title')}</h1>
        <p class="ui:text-muted-foreground mb-6 text-sm">{$t('course.creator.wizard.steps.type.subtitle')}</p>

        <div class="grid gap-3 sm:grid-cols-2">
          {#each TYPE_OPTIONS as option (option.value)}
            {@const isSelected = courseType === option.value}
            <button
              type="button"
              class="flex h-full min-h-[120px] w-full cursor-pointer flex-col items-start gap-3 rounded-2xl border p-5 text-left transition-colors {isSelected
                ? 'ui:bg-primary/5 ui:border-primary ui:ring-primary/20 ui:ring-2'
                : 'ui:bg-card ui:border-border hover:ui:border-primary'}"
              onclick={() => (courseType = option.value)}
              aria-pressed={isSelected}
            >
              <div class="ui:text-primary ui:bg-primary/10 flex size-10 shrink-0 items-center justify-center rounded-lg">
                {#if option.iconName === 'GraduationCap'}
                  <GraduationCapIcon class="size-6" />
                {:else if option.iconName === 'Compass'}
                  <CompassIcon class="size-6" />
                {:else if option.iconName === 'Award'}
                  <AwardIcon class="size-6" />
                {:else}
                  <SparklesIcon class="size-6" />
                {/if}
              </div>
              <span class="ui:text-foreground text-sm leading-tight font-semibold">{$t(option.titleKey)}</span>
              <span class="ui:text-muted-foreground text-xs leading-snug">{$t(option.descriptionKey)}</span>
            </button>
          {/each}
        </div>
      {/if}

      <!-- Step 2: Topic & goal -->
      {#if currentStep === 2}
        <h1 class="mb-1 text-2xl font-semibold">{$t('course.creator.wizard.steps.topic.title')}</h1>
        <p class="ui:text-muted-foreground mb-6 text-sm">{$t('course.creator.wizard.steps.topic.subtitle')}</p>

        <div class="flex flex-col gap-5">
          <div class="flex flex-col gap-2">
            <span class="text-sm font-medium">{$t('course.creator.wizard.topic.topic_label')}</span>
            <Textarea bind:value={topic} placeholder={$t('course.creator.wizard.topic.topic_placeholder')} rows={2} />
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

          <div class="flex flex-col gap-2">
            <span class="text-sm font-medium">{$t('course.creator.wizard.topic.goal_label')}</span>
            <Textarea bind:value={goal} placeholder={$t('course.creator.wizard.topic.goal_placeholder')} rows={3} />
          </div>
        </div>
      {/if}

      <!-- Step 3: Audience & level -->
      {#if currentStep === 3}
        <h1 class="mb-1 text-2xl font-semibold">{$t('course.creator.wizard.steps.audience.title')}</h1>
        <p class="ui:text-muted-foreground mb-6 text-sm">{$t('course.creator.wizard.steps.audience.subtitle')}</p>

        <div class="flex flex-col gap-5">
          <div class="flex flex-col gap-2">
            <span class="text-sm font-medium">{$t('course.creator.wizard.audience.audience_label')}</span>
            <Input bind:value={audience} placeholder={$t('course.creator.wizard.audience.audience_placeholder')} />
          </div>

          <div class="flex flex-col gap-2">
            <span class="text-sm font-medium">{$t('course.creator.wizard.audience.level_label')}</span>
            <Select.Root type="single" bind:value={level}>
              <Select.Trigger class="ui:w-full">{selectedLevelLabel()}</Select.Trigger>
              <Select.Content>
                {#each LEVEL_OPTIONS as option (option.value)}
                  <Select.Item value={option.value} label={$t(option.labelKey)}>{$t(option.labelKey)}</Select.Item>
                {/each}
              </Select.Content>
            </Select.Root>
          </div>
        </div>
      {/if}

      <!-- Step 4: Source material -->
      {#if currentStep === 4}
        <h1 class="mb-1 text-2xl font-semibold">{$t('course.creator.wizard.steps.source.title')}</h1>
        <p class="ui:text-muted-foreground mb-6 text-sm">{$t('course.creator.wizard.steps.source.subtitle')}</p>

        <input bind:this={fileInputEl} type="file" accept={ACCEPT} class="hidden" onchange={handleFileChange} />

        <div class="flex flex-col gap-5">
          <div class="flex flex-col gap-2">
            <span class="text-sm font-medium">{$t('course.creator.wizard.source.document_label')}</span>
            {#if uploadedDoc}
              <div class="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
                <FileTextIcon class="ui:text-primary size-4 shrink-0" />
                <span class="min-w-0 flex-1 truncate">{uploadedDoc.name}</span>
                <button type="button" onclick={removeDoc} aria-label="remove" class="ui:text-muted-foreground hover:ui:text-foreground">
                  <XIcon class="size-4" />
                </button>
              </div>
            {:else}
              <Button variant="outline" size="sm" class="w-fit" disabled={isUploading} onclick={handlePickFile}>
                {#if isUploading}
                  <LoaderCircleIcon class="size-4 animate-spin" />
                {:else}
                  <FileTextIcon class="size-4" />
                {/if}
                {$t('course.creator.wizard.source.upload_button')}
              </Button>
            {/if}
            {#if uploadError}
              <p class="text-xs text-red-500">{uploadError}</p>
            {/if}
            <p class="ui:text-muted-foreground text-xs">{$t('course.creator.wizard.source.document_hint')}</p>
          </div>

          <div class="flex flex-col gap-2">
            <span class="text-sm font-medium">{$t('course.creator.wizard.source.url_label')}</span>
            {#each docUrls as _, index (index)}
              <div class="flex items-center gap-2">
                <GlobeIcon class="ui:text-muted-foreground size-4 shrink-0" />
                <Input bind:value={docUrls[index]} type="url" placeholder={$t('course.creator.wizard.source.url_placeholder')} />
                {#if docUrls.length > 1}
                  <button type="button" onclick={() => removeUrlField(index)} aria-label="remove url" class="ui:text-muted-foreground hover:ui:text-foreground">
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
              {$t('course.creator.wizard.source.add_url')}
            </button>
          </div>
        </div>
      {/if}
    </div>

    <!-- Nav -->
    <div class="mt-8 flex items-center justify-between">
      {#if currentStep > 1}
        <Button variant="ghost" onclick={back}>{$t('course.creator.wizard.nav.back')}</Button>
      {:else}
        <span></span>
      {/if}

      {#if currentStep < TOTAL_STEPS}
        <Button onclick={next} disabled={!canProceed}>{$t('course.creator.wizard.nav.next')}</Button>
      {:else}
        <Button onclick={handleFinish}>{$t('course.creator.wizard.nav.finish')}</Button>
      {/if}
    </div>
  </div>
{/if}
