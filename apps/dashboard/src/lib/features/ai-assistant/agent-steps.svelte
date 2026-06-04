<script lang="ts">
  import CheckIcon from '@lucide/svelte/icons/check';
  import LoaderIcon from '@lucide/svelte/icons/loader';
  import CircleIcon from '@lucide/svelte/icons/circle';
  import AlertCircleIcon from '@lucide/svelte/icons/alert-circle';
  import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
  import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
  import ToolLine from '$features/ai-assistant/utils/tool-line.svelte';
  import type { ProgressStep } from '$features/ai-assistant/utils/tool-labels';
  import { t } from '$lib/utils/functions/translations';

  interface Props {
    steps: ProgressStep[];
    courseId: string;
    onNavigate: (route: string) => void;
    /** Start collapsed (used in the message bubble for finished turns). */
    startCollapsed?: boolean;
  }

  let { steps, courseId, onNavigate, startCollapsed = true }: Props = $props();

  const completedCount = $derived(steps.filter((s) => s.status === 'completed').length);

  let expanded = $state(!startCollapsed);

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
</script>

<div class="ui:bg-background/60 rounded-md border">
  <button
    type="button"
    onclick={() => (expanded = !expanded)}
    class="hover:ui:bg-muted/40 flex w-full items-center gap-2 rounded-md px-3 py-2 text-left transition-colors"
  >
    {#if expanded}
      <ChevronDownIcon size={14} class="ui:text-muted-foreground shrink-0" />
    {:else}
      <ChevronRightIcon size={14} class="ui:text-muted-foreground shrink-0" />
    {/if}
    <CheckIcon size={12} class="ui:text-primary shrink-0" />
    <span class="text-xs font-medium">
      {$t('ai_assistant.plan_steps_collapsed', { count: completedCount })}
    </span>
  </button>

  {#if expanded}
    <div class="space-y-0.5 border-t p-2">
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
          <span class={step.status === 'pending' ? 'ui:text-muted-foreground' : ''}>
            <ToolLine line={step.line} {courseId} {onNavigate} />
          </span>
        </div>
      {/each}
    </div>
  {/if}
</div>
