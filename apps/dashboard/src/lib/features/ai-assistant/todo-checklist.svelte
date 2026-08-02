<script lang="ts">
  import CheckCircleIcon from '@lucide/svelte/icons/circle-check';
  import CircleDashedIcon from '@lucide/svelte/icons/circle-dashed';
  import CircleIcon from '@lucide/svelte/icons/circle';
  import ListChecksIcon from '@lucide/svelte/icons/list-checks';
  import { t } from '$lib/utils/functions/translations';
  import type { AiAssistantPlanProgress } from '$features/ai-assistant/utils/types';

  interface Props {
    progress: AiAssistantPlanProgress;
  }

  let { progress }: Props = $props();

  const percentage = $derived(
    progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0
  );
  const allDone = $derived(progress.total > 0 && progress.completed === progress.total);

  // Sections carry the item rows underneath them, so indenting lessons/exercises
  // makes the plan's shape readable at a glance.
  const isNested = (kind: string) => kind !== 'section';
</script>

<div class="ui:bg-background mt-3 rounded-lg border">
  <div class="flex items-center justify-between gap-2 border-b px-3 py-2">
    <div class="flex items-center gap-2">
      <ListChecksIcon size={15} class="ui:text-primary shrink-0" />
      <span class="text-sm font-medium">{$t('ai_assistant.todo_checklist.title')}</span>
    </div>
    <span class="text-xs {allDone ? 'ui:text-primary font-medium' : 'ui:text-muted-foreground'}">
      {progress.completed}/{progress.total} · {percentage}%
    </span>
  </div>

  <!-- Progress bar -->
  <div class="ui:bg-muted h-1 w-full overflow-hidden">
    <div class="ui:bg-primary h-full transition-all duration-300" style="width: {percentage}%"></div>
  </div>

  <ul class="flex flex-col gap-0.5 px-2 py-2">
    {#each progress.items as item, index (item.key || `${item.kind}-${index}`)}
      <li
        class="flex items-start gap-2 rounded-md px-1.5 py-1 text-xs {isNested(item.kind)
          ? 'ps-5'
          : ''}"
      >
        {#if item.status === 'done'}
          <CheckCircleIcon size={14} class="ui:text-primary mt-0.5 shrink-0" />
          <span class="ui:text-muted-foreground min-w-0 flex-1 break-words line-through"
            >{item.title}</span
          >
        {:else if item.status === 'empty'}
          <!-- Created but not written yet: distinct from "missing" so the teacher
               can see the difference between an empty shell and nothing at all. -->
          <CircleDashedIcon size={14} class="ui:text-primary mt-0.5 shrink-0" />
          <span class="min-w-0 flex-1 break-words font-medium">{item.title}</span>
        {:else}
          <CircleIcon size={14} class="ui:text-muted-foreground mt-0.5 shrink-0" />
          <span class="ui:text-muted-foreground min-w-0 flex-1 break-words">{item.title}</span>
        {/if}
      </li>
    {/each}
  </ul>
</div>
