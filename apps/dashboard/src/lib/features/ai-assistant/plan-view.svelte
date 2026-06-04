<script lang="ts">
  import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
  import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
  import BookOpenIcon from '@lucide/svelte/icons/book-open';
  import FileQuestionIcon from '@lucide/svelte/icons/file-question';
  import PencilIcon from '@lucide/svelte/icons/pencil';
  import CheckCircleIcon from '@lucide/svelte/icons/circle-check';
  import { Button } from '@cio/ui/base/button';
  import { SvelteSet } from 'svelte/reactivity';
  import { t } from '$lib/utils/functions/translations';
  import type { CoursePlan } from './utils/course-plan';

  /** Token cost estimation heuristics (tokens per item) */
  const TOKEN_COST_ESTIMATES = {
    SECTION_CREATE: 500,
    LESSON_CREATE_AND_CONTENT: 3000,
    EXERCISE_CREATE: 1500
  } as const;

  interface Props {
    plan: CoursePlan;
    onImplement: (editedPlan: CoursePlan) => void;
    /** Focuses the main chat input so the teacher can type the change they want. */
    onRequestChanges: () => void;
    /** When true, the agent is already working — disables the action buttons. */
    isBusy?: boolean;
    /** When true, this plan was already sent for implementation — hide the action buttons. */
    implemented?: boolean;
    remainingTokens?: number;
  }

  let { plan, onImplement, onRequestChanges, isBusy = false, implemented = false, remainingTokens }: Props = $props();

  // CoursePlan is plain JSON; structuredClone fails when the AI SDK part carries
  // non-cloneable internals, so JSON round-trip is both safer and sufficient.
  function clonePlan(input: CoursePlan): CoursePlan {
    return JSON.parse(JSON.stringify(input)) as CoursePlan;
  }

  // Local editable copy of the plan
  let editablePlan: CoursePlan = $state(clonePlan(plan));

  // Reset editable plan when the prop changes (e.g., agent revises the plan)
  $effect(() => {
    editablePlan = clonePlan(plan);
  });

  let expandedSections = new SvelteSet<number>();

  $effect(() => {
    expandedSections.clear();

    for (let i = 0; i < editablePlan.sections.length; i++) {
      expandedSections.add(i);
    }
  });

  // Track which field is being edited: "section-0-title", "lesson-1-2-title", "lesson-1-2-desc"
  let editingField: string | null = $state(null);

  function toggleSection(index: number) {
    if (expandedSections.has(index)) {
      expandedSections.delete(index);
    } else {
      expandedSections.add(index);
    }
  }

  function startEditing(fieldKey: string) {
    editingField = fieldKey;
  }

  function stopEditing() {
    editingField = null;
  }

  function handleEditKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      event.preventDefault();
      stopEditing();
    }

    if (event.key === 'Escape') {
      stopEditing();
    }
  }

  const totalLessons = $derived(
    editablePlan.sections.reduce((sum, s) => sum + s.items.filter((i) => i.type === 'lesson').length, 0)
  );
  const totalExercises = $derived(
    editablePlan.sections.reduce(
      (sum, s) => sum + s.items.filter((i) => i.type === 'exercise' || i.hasExercise).length,
      0
    )
  );

  const estimatedTokens = $derived(
    editablePlan.sections.length * TOKEN_COST_ESTIMATES.SECTION_CREATE +
      totalLessons * TOKEN_COST_ESTIMATES.LESSON_CREATE_AND_CONTENT +
      totalExercises * TOKEN_COST_ESTIMATES.EXERCISE_CREATE
  );

  const costPercentage = $derived(remainingTokens ? Math.round((estimatedTokens / remainingTokens) * 100) : null);
  const isHighCost = $derived(costPercentage !== null && costPercentage > 50);
</script>

<div class="ui:bg-background rounded-lg border">
  <!-- Plan header -->
  <div class="border-b px-4 py-3">
    {#if editingField === 'plan-title'}
      <input
        type="text"
        bind:value={editablePlan.title}
        onblur={stopEditing}
        onkeydown={handleEditKeydown}
        class="ui:bg-muted/50 focus:ui:ring-primary w-full rounded border px-1 py-0.5 text-sm font-semibold focus:ring-1 focus:outline-none"
        autofocus
      />
    {:else}
      <button
        onclick={() => startEditing('plan-title')}
        class="group hover:ui:text-primary flex items-center gap-1 text-left text-sm font-semibold"
      >
        {editablePlan.title}
        <PencilIcon size={10} class="opacity-0 group-hover:opacity-50" />
      </button>
    {/if}
    <p class="ui:text-muted-foreground text-xs">
      {editablePlan.sections.length} sections, {totalLessons} lessons{totalExercises > 0
        ? `, ${totalExercises} exercises`
        : ''}
    </p>
  </div>

  <!-- Sections tree (grows naturally; the chat provides the single scroll) -->
  <div class="p-2">
    {#each editablePlan.sections as section, sectionIndex (sectionIndex)}
      <div class="mb-1">
        <div class="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-xs font-medium">
          <button onclick={() => toggleSection(sectionIndex)} class="flex-shrink-0">
            {#if expandedSections.has(sectionIndex)}
              <ChevronDownIcon size={12} />
            {:else}
              <ChevronRightIcon size={12} />
            {/if}
          </button>

          {#if editingField === `section-${sectionIndex}-title`}
            <input
              type="text"
              bind:value={editablePlan.sections[sectionIndex].title}
              onblur={stopEditing}
              onkeydown={handleEditKeydown}
              class="ui:bg-muted/50 focus:ui:ring-primary flex-1 rounded border px-1 py-0.5 text-xs focus:ring-1 focus:outline-none"
              autofocus
            />
          {:else}
            <button
              onclick={() => startEditing(`section-${sectionIndex}-title`)}
              class="group hover:ui:text-primary flex items-center gap-1 text-left"
            >
              Section {section.order}: {section.title}
              <PencilIcon size={9} class="opacity-0 group-hover:opacity-50" />
            </button>
          {/if}
        </div>

        {#if expandedSections.has(sectionIndex)}
          <div class="ml-5 space-y-1">
            {#each section.items as item, itemIndex (item.order)}
              <div class="flex items-start gap-1.5 rounded px-2 py-1 text-xs">
                {#if item.type === 'exercise'}
                  <FileQuestionIcon size={11} class="ui:text-primary mt-0.5 flex-shrink-0" />
                {:else}
                  <BookOpenIcon size={11} class="ui:text-muted-foreground mt-0.5 flex-shrink-0" />
                {/if}
                <div class="min-w-0 flex-1">
                  {#if editingField === `item-${sectionIndex}-${itemIndex}-title`}
                    <input
                      type="text"
                      bind:value={editablePlan.sections[sectionIndex].items[itemIndex].title}
                      onblur={stopEditing}
                      onkeydown={handleEditKeydown}
                      class="ui:bg-muted/50 focus:ui:ring-primary w-full rounded border px-1 py-0.5 text-xs font-medium focus:ring-1 focus:outline-none"
                      autofocus
                    />
                  {:else}
                    <button
                      onclick={() => startEditing(`item-${sectionIndex}-${itemIndex}-title`)}
                      class="group hover:ui:text-primary flex items-center gap-1 text-left font-medium"
                    >
                      {#if item.type === 'exercise'}
                        <span class="ui:text-primary">{item.title}</span>
                      {:else}
                        {item.title}
                      {/if}
                      <PencilIcon size={9} class="opacity-0 group-hover:opacity-50" />
                    </button>
                  {/if}

                  {#if editingField === `item-${sectionIndex}-${itemIndex}-desc`}
                    <textarea
                      bind:value={editablePlan.sections[sectionIndex].items[itemIndex].description}
                      onblur={stopEditing}
                      onkeydown={handleEditKeydown}
                      rows={2}
                      class="ui:bg-muted/50 ui:text-muted-foreground focus:ui:ring-primary mt-0.5 w-full rounded border px-1 py-0.5 text-xs focus:ring-1 focus:outline-none"
                      autofocus
                    ></textarea>
                  {:else}
                    <button
                      onclick={() => startEditing(`item-${sectionIndex}-${itemIndex}-desc`)}
                      class="group ui:text-muted-foreground hover:ui:text-foreground mt-0.5 flex items-start gap-1 text-left"
                    >
                      <span class="line-clamp-2">{item.description}</span>
                      <PencilIcon size={9} class="mt-0.5 flex-shrink-0 opacity-0 group-hover:opacity-50" />
                    </button>
                  {/if}

                  {#if item.type === 'lesson' && item.hasExercise}
                    <div class="ui:text-muted-foreground mt-0.5 flex items-center gap-1">
                      <FileQuestionIcon size={10} />
                      <span>Exercise included</span>
                    </div>
                  {/if}
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {/each}
  </div>

  <!-- Cost estimate + actions -->
  <div class="space-y-3 border-t px-4 py-3">
    {#if estimatedTokens > 0}
      <p class="text-xs {isHighCost ? 'text-amber-600 dark:text-amber-400' : 'ui:text-muted-foreground'}">
        {#if costPercentage !== null}
          {$t('ai_assistant.plan_estimated_cost_with_pct', { count: estimatedTokens, pct: costPercentage })}
        {:else}
          {$t('ai_assistant.plan_estimated_cost', { count: estimatedTokens })}
        {/if}
      </p>
    {/if}

    {#if implemented}
      <div class="ui:text-muted-foreground flex items-center gap-2 text-xs">
        <CheckCircleIcon size={14} class="text-green-500" />
        {$t('ai_assistant.plan_implemented')}
      </div>
    {:else}
      <div class="flex gap-2">
        <Button size="sm" variant="outline" disabled={isBusy} onclick={onRequestChanges} class="flex-1">
          {$t('ai_assistant.plan_request_changes')}
        </Button>
        <Button size="sm" disabled={isBusy} onclick={() => onImplement(editablePlan)} class="flex-1">
          {$t('ai_assistant.plan_implement')}
        </Button>
      </div>
    {/if}
  </div>
</div>
