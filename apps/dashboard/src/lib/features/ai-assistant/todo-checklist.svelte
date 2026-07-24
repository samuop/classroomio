<script lang="ts">
  import CheckCircleIcon from '@lucide/svelte/icons/circle-check';
  import LoaderIcon from '@lucide/svelte/icons/loader';
  import CircleIcon from '@lucide/svelte/icons/circle';
  import ListChecksIcon from '@lucide/svelte/icons/list-checks';
  import { t } from '$lib/utils/functions/translations';

  type TodoStatus = 'pending' | 'in_progress' | 'completed';

  interface TodoItem {
    key: string;
    content: string;
    status: TodoStatus;
    priority?: 'low' | 'medium' | 'high';
  }

  interface Props {
    todos: TodoItem[];
    total: number;
    completed: number;
    remaining: number;
    allDone: boolean;
  }

  let { todos, total, completed, allDone }: Props = $props();

  const percentage = $derived(total > 0 ? Math.round((completed / total) * 100) : 0);
</script>

<div class="ui:bg-background mt-3 rounded-lg border">
  <div class="flex items-center justify-between gap-2 border-b px-3 py-2">
    <div class="flex items-center gap-2">
      <ListChecksIcon size={15} class="ui:text-primary shrink-0" />
      <span class="text-sm font-medium">{$t('ai_assistant.todo_checklist.title')}</span>
    </div>
    <span
      class="text-xs {allDone ? 'ui:text-primary font-medium' : 'ui:text-muted-foreground'}"
    >
      {completed}/{total} · {percentage}%
    </span>
  </div>

  <!-- Progress bar -->
  <div class="ui:bg-muted h-1 w-full overflow-hidden">
    <div
      class="ui:bg-primary h-full transition-all duration-300"
      style="width: {percentage}%"
    ></div>
  </div>

  <ul class="flex flex-col gap-0.5 px-2 py-2">
    {#each todos as todo (todo.key)}
      <li class="flex items-start gap-2 rounded-md px-1.5 py-1 text-xs">
        {#if todo.status === 'completed'}
          <CheckCircleIcon size={14} class="ui:text-primary mt-0.5 shrink-0" />
          <span class="ui:text-muted-foreground min-w-0 flex-1 break-words line-through">{todo.content}</span>
        {:else if todo.status === 'in_progress'}
          <LoaderIcon size={14} class="ui:text-primary mt-0.5 shrink-0 animate-spin" />
          <span class="min-w-0 flex-1 break-words font-medium">{todo.content}</span>
        {:else}
          <CircleIcon size={14} class="ui:text-muted-foreground mt-0.5 shrink-0" />
          <span class="ui:text-muted-foreground min-w-0 flex-1 break-words">{todo.content}</span>
        {/if}
      </li>
    {/each}
  </ul>
</div>
