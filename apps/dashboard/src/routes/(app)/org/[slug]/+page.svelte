<script lang="ts">
  import { brandName } from '$lib/utils/branding';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import CheckCircleIcon from '@lucide/svelte/icons/circle-check';
  import CircleIcon from '@lucide/svelte/icons/circle';
  import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';

  import { t } from '$lib/utils/functions/translations';
  import { CourseCreator } from '@cio/ui/custom/course-creator';
  import { aiAssistantApi } from '$features/ai-assistant/api/ai-assistant.svelte';
  import { courseApi } from '$features/course/api';
  import { setInitialChatPrompt, setInitialChatTemplateId } from '$features/ai-assistant/utils/store';
  import { DISPLAY_BY_ID } from '$features/ai-assistant/utils/template-display';
  import { COURSE_TEMPLATES, type CourseTemplate, type CourseTemplateId } from '@cio/ai-assistant';
  import GraduationCapIcon from '@lucide/svelte/icons/graduation-cap';
  import CompassIcon from '@lucide/svelte/icons/compass';
  import AwardIcon from '@lucide/svelte/icons/award';
  import type { TCourseType } from '@cio/db/types';

  type CreatingStep = 'reading' | 'naming' | 'building';

  const steps: { key: CreatingStep; label: string }[] = [
    { key: 'reading', label: t.get('course.creator.drafting.step_reading') },
    { key: 'naming', label: t.get('course.creator.drafting.step_naming') },
    { key: 'building', label: t.get('course.creator.drafting.step_building') }
  ];

  let creatingState: 'idle' | 'creating' = $state('idle');
  let creatingStep: CreatingStep = $state('reading');
  let draftingPrompt = $state('');
  let composerPrompt = $state('');
  let pinnedTemplatePrompt: string | null = $state(null);
  let selectedTemplateId: CourseTemplateId | null = $state(null);

  function stepStatus(key: CreatingStep): 'done' | 'active' | 'pending' {
    const order: CreatingStep[] = ['reading', 'naming', 'building'];
    const current = order.indexOf(creatingStep);
    const target = order.indexOf(key);

    if (target < current) return 'done';
    if (target === current) return 'active';

    return 'pending';
  }

  function selectTemplate(template: CourseTemplate) {
    composerPrompt = template.promptTemplate;
    pinnedTemplatePrompt = template.promptTemplate;
    selectedTemplateId = template.id;
  }

  $effect(() => {
    if (!selectedTemplateId || pinnedTemplatePrompt === null) {
      return;
    }

    if (composerPrompt !== pinnedTemplatePrompt) {
      selectedTemplateId = null;
      pinnedTemplatePrompt = null;
    }
  });

  async function handleCreate({ prompt, level }: { prompt: string; level: string }) {
    draftingPrompt = prompt;
    creatingState = 'creating';
    creatingStep = 'reading';

    await new Promise((r) => setTimeout(r, 700));

    creatingStep = 'naming';

    const template = selectedTemplateId ? COURSE_TEMPLATES.find((tpl) => tpl.id === selectedTemplateId) : undefined;

    const promptIsStillTemplateDefault = template !== undefined && prompt.trim() === template.promptTemplate.trim();

    let title: string;
    let description: string;

    if (promptIsStillTemplateDefault) {
      title = t.get('course.creator.untitled_course');
      description = t.get('course.creator.untitled_course_description');
    } else {
      const meta = await aiAssistantApi.generateCourseMeta(prompt);
      title = meta?.title ?? prompt.slice(0, 80);
      description = meta?.description ?? prompt.slice(0, 150);
    }

    creatingStep = 'building';
    setInitialChatPrompt(`${prompt}\n\nCourse type: Self-paced. Level: ${level}.`);

    if (selectedTemplateId) {
      setInitialChatTemplateId(selectedTemplateId);
    }

    await courseApi.create({ title, description, type: 'SELF_PACED' as TCourseType }, (courseId) => {
      goto(resolve(`/courses/${courseId}/lessons`, {}));
    });
  }

</script>

<svelte:head>
  <title>Home - {brandName}</title>
</svelte:head>

{#if creatingState === 'creating'}
  <div class="flex min-h-[80vh] flex-col items-center justify-center gap-6 px-4">
    <div class="flex flex-col items-center gap-2 text-center">
      <h1 class="text-2xl font-semibold">{$t('course.creator.drafting.heading')}</h1>
      <p class="ui:text-muted-foreground text-sm">
        {$t('course.creator.drafting.subtext')}
      </p>
    </div>

    <div class="ui:border w-full max-w-lg rounded-2xl p-5">
      <p class="mb-5 text-sm text-neutral-300 italic">"{draftingPrompt}"</p>

      <div class="flex flex-col gap-3">
        {#each steps as step (step.key)}
          {@const status = stepStatus(step.key)}
          <div class="flex items-center gap-3">
            {#if status === 'done'}
              <CheckCircleIcon class="h-4 w-4 shrink-0 text-green-500" />
            {:else if status === 'active'}
              <LoaderCircleIcon class="h-4 w-4 shrink-0 animate-spin text-white" />
            {:else}
              <CircleIcon class="h-4 w-4 shrink-0 text-neutral-600" />
            {/if}
            <span
              class="text-sm {status === 'done'
                ? 'text-neutral-400 line-through'
                : status === 'active'
                  ? 'ui:text-foreground'
                  : 'ui:text-muted-foreground'}"
            >
              {step.label}
            </span>
          </div>
        {/each}
      </div>
    </div>
  </div>
{:else}
  <div class="flex min-h-[90vh] items-center justify-center px-4 py-12">
    <div class="w-full max-w-3xl">
      <CourseCreator
        heading={$t('course.creator.heading')}
        placeholder={$t('course.creator.placeholder')}
        bind:prompt={composerPrompt}
        levelOptions={[
          { value: 'beginner', label: $t('course.creator.level.beginner') },
          { value: 'intermediate', label: $t('course.creator.level.intermediate') },
          { value: 'advanced', label: $t('course.creator.level.advanced') }
        ]}
        onsubmit={handleCreate}
      />

      <p class="ui:text-muted-foreground my-3 text-center text-sm font-medium">
        {$t('course.creator.template.heading')}
      </p>
      <div class="grid gap-3 sm:grid-cols-3">
        {#each COURSE_TEMPLATES as template (template.id)}
          {@const display = DISPLAY_BY_ID[template.id]}
          {@const isSelected = selectedTemplateId === template.id}
          <button
            type="button"
            class="group ui:border ui:transition-colors focus-visible:ui:ring-[3px] focus-visible:ui:ring-ring/50 focus-visible:ui:outline-none flex h-full min-h-[168px] w-full cursor-pointer flex-col items-start gap-3 rounded-2xl p-5 text-left sm:p-6 {isSelected
              ? 'ui:bg-primary/5 ui:border-primary ui:ring-primary/20 ui:ring-2'
              : 'ui:bg-card ui:border-border ui:hover:border-primary'}"
            onclick={() => selectTemplate(template)}
            aria-label={$t(display.titleKey)}
            aria-pressed={isSelected}
          >
            <div class="ui:text-primary ui:bg-primary/10 flex size-10 shrink-0 items-center justify-center rounded-lg">
              {#if display.iconName === 'GraduationCap'}
                <GraduationCapIcon class="size-6" />
              {:else if display.iconName === 'Compass'}
                <CompassIcon class="size-6" />
              {:else}
                <AwardIcon class="size-6" />
              {/if}
            </div>
            <span class="ui:text-foreground text-sm leading-tight font-semibold">
              {$t(display.titleKey)}
            </span>
            <span class="ui:text-muted-foreground text-xs leading-snug">
              {$t(display.descriptionKey)}
            </span>
          </button>
        {/each}
      </div>
    </div>
  </div>
{/if}
