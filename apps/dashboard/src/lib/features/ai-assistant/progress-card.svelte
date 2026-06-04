<script lang="ts">
  import CheckIcon from '@lucide/svelte/icons/check';
  import LoaderIcon from '@lucide/svelte/icons/loader';
  import CircleIcon from '@lucide/svelte/icons/circle';
  import AlertCircleIcon from '@lucide/svelte/icons/alert-circle';
  import SquareIcon from '@lucide/svelte/icons/square';
  import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
  import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
  import { Button } from '@cio/ui/base/button';
  import ToolLine from '$features/ai-assistant/utils/tool-line.svelte';
  import type { ProgressStep, ToolLineUi } from '$features/ai-assistant/utils/tool-labels';
  import { t } from '$lib/utils/functions/translations';

  interface Props {
    titleKey: string;
    steps: ProgressStep[];
    courseId: string;
    /** Same handler as `@mention` clicks (SPA navigation into lesson / exercise). */
    onNavigate: (route: string) => void;
    currentActionLine?: ToolLineUi;
    onStop?: () => void;
    isStopped?: boolean;
    error?: string;
  }

  let { titleKey, steps, courseId, onNavigate, currentActionLine, onStop, isStopped = false, error }: Props = $props();

  function stepRowKey(step: ProgressStep, index: number): string {
    if (step.line.shape === 'i18n') {
      return `${index}-${step.line.key}-${JSON.stringify(step.line.vars ?? {})}`;
    }

    if (step.line.shape === 'lesson_written') {
      return `${index}-lesson-${step.line.lessonId}-${step.line.charCount}-${step.line.title}`;
    }

    if (step.line.shape === 'landing_page_updated') {
      return `${index}-landing-${step.line.title}`;
    }

    return `${index}-exo-${step.line.exerciseId}-${step.line.action}-${step.line.count}-${step.line.title}`;
  }

  const completedCount = $derived(steps.filter((s) => s.status === 'completed').length);
  const totalCount = $derived(steps.length);

  // Once every step is done, the detailed step list competes with the assistant's
  // text reply, so collapse it to a single summary line. Still expandable on click.
  const allCompleted = $derived(totalCount > 0 && completedCount === totalCount);
  let userExpanded = $state(false);
  const showSteps = $derived(!allCompleted || userExpanded);
</script>

<div class="ui:bg-background rounded-lg border">
  {#if allCompleted}
    <!-- Collapsed summary: a single clickable line once all steps are done, so the
         step list stops competing with the assistant's text reply. -->
    <button
      type="button"
      onclick={() => (userExpanded = !userExpanded)}
      class="hover:ui:bg-muted/50 flex w-full items-center gap-2 px-4 py-2.5 text-left transition-colors"
    >
      {#if userExpanded}
        <ChevronDownIcon size={14} class="ui:text-muted-foreground shrink-0" />
      {:else}
        <ChevronRightIcon size={14} class="ui:text-muted-foreground shrink-0" />
      {/if}
      <CheckIcon size={12} class="ui:text-primary shrink-0" />
      <span class="text-xs font-medium">
        {$t('ai_assistant.plan_steps_collapsed', { count: completedCount })}
      </span>
    </button>
  {:else}
    <div class="border-b px-4 py-3">
      <h4 class="text-sm font-semibold">{$t(titleKey)}</h4>
      <p class="ui:text-muted-foreground text-xs">
        {$t('ai_assistant.plan_progress', { completed: completedCount, total: totalCount })}
      </p>
    </div>
  {/if}

  {#if showSteps}
    <div class="space-y-0.5 p-2 {allCompleted ? 'border-t' : ''}">
      {#each steps as step, i (stepRowKey(step, i))}
        <div class="flex items-center gap-2 rounded px-2 py-1 text-xs {step.indent ? 'ml-4' : ''}">
          {#if step.status === 'completed'}
            <CheckIcon size={12} class="ui:text-primary shrink-0" />
          {:else if step.status === 'in_progress'}
            <LoaderIcon size={12} class="ui:text-primary shrink-0 animate-spin" />
          {:else if step.status === 'failed'}
            <AlertCircleIcon size={12} class="shrink-0 text-red-500" />
          {:else}
            <CircleIcon size={12} class="ui:text-muted-foreground shrink-0" />
          {/if}
          <span class={step.status === 'completed' ? '' : step.status === 'pending' ? 'ui:text-muted-foreground' : ''}>
            <ToolLine line={step.line} {courseId} {onNavigate} />
          </span>
        </div>
      {/each}
    </div>
  {/if}

  {#if !allCompleted || error || isStopped}
    <div class="space-y-1 border-t px-4 py-3">
    {#if error}
      <p class="text-xs text-red-600 dark:text-red-400">{error}</p>
    {/if}

    {#if currentActionLine && !isStopped}
      <div class="ui:text-muted-foreground text-xs leading-snug">
        <ToolLine line={currentActionLine} {courseId} {onNavigate} />
      </div>
    {/if}

    {#if isStopped}
      <p class="ui:text-muted-foreground text-xs">{$t('ai_assistant.stopped_content_kept')}</p>
    {/if}

    {#if onStop && !isStopped && completedCount < totalCount}
      <Button size="sm" variant="outline" onclick={onStop} class="w-full">
        <SquareIcon size={12} class="mr-1" />
        {$t('ai_assistant.stop')}
      </Button>
    {/if}
    </div>
  {/if}
</div>
