<script lang="ts">
  import { Button } from '@cio/ui/base/button';
  import { Input } from '@cio/ui/base/input';
  import LoaderIcon from '@lucide/svelte/icons/loader';
  import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
  import WandSparklesIcon from '@lucide/svelte/icons/wand-sparkles';
  import AlertTriangleIcon from '@lucide/svelte/icons/triangle-alert';
  import { t } from '$lib/utils/functions/translations';

  /**
   * Controls that appear over a lesson diagram for instructors: redraw it, or say
   * what to change in plain language and iterate until it looks right.
   *
   * The diagram is identified by its position among the lesson's SVGs, and the
   * server splices the replacement into that exact slot — so nothing depends on
   * the model reproducing the old markup, which is how the chat's find-and-replace
   * edit usually fails.
   */
  interface Props {
    index: number;
    isBusy?: boolean;
    /** Set when the lesson has unsaved edits: the server rewrites SAVED content. */
    blockedByDraft?: boolean;
    warnings?: string[];
    onSubmit: (index: number, instruction?: string) => void | Promise<void>;
  }

  let { index, isBusy = false, blockedByDraft = false, warnings = [], onSubmit }: Props = $props();

  let instruction = $state('');
  let expanded = $state(false);

  const disabled = $derived(isBusy || blockedByDraft);

  async function submit(withInstruction: boolean) {
    if (disabled) return;
    const text = instruction.trim();
    if (withInstruction && !text) return;

    await onSubmit(index, withInstruction ? text : undefined);
    if (withInstruction) instruction = '';
  }
</script>

<!-- Hover OR keyboard focus reveals the bar, so it is reachable without a mouse. -->
<div class="group/diagram absolute inset-0 flex flex-col justify-between">
  <div
    class="pointer-events-none flex justify-end p-2 opacity-0 transition-opacity group-hover/diagram:opacity-100 focus-within:opacity-100"
  >
    <div class="ui:bg-background pointer-events-auto flex items-center gap-1 rounded-md border p-1 shadow-sm">
      {#if blockedByDraft}
        <span class="ui:text-muted-foreground px-2 text-xs">{$t('course.diagram.save_first')}</span>
      {:else}
        <Button variant="ghost" size="sm" {disabled} onclick={() => submit(false)} title={$t('course.diagram.regenerate')}>
          {#if isBusy}
            <LoaderIcon size={13} class="animate-spin" />
          {:else}
            <RefreshCwIcon size={13} />
          {/if}
          <span class="ml-1 text-xs">{$t('course.diagram.regenerate')}</span>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          {disabled}
          onclick={() => (expanded = !expanded)}
          title={$t('course.diagram.ask_change')}
        >
          <WandSparklesIcon size={13} />
        </Button>
      {/if}
    </div>
  </div>

  {#if expanded && !blockedByDraft}
    <div class="pointer-events-auto p-2">
      <div class="ui:bg-background flex items-center gap-1 rounded-md border p-1 shadow-sm">
        <Input
          bind:value={instruction}
          placeholder={$t('course.diagram.ask_change_placeholder')}
          {disabled}
          onkeydown={(event: KeyboardEvent) => {
            if (event.key === 'Enter') submit(true);
            if (event.key === 'Escape') expanded = false;
          }}
          class="h-8 text-xs"
        />
        <Button size="sm" disabled={disabled || !instruction.trim()} onclick={() => submit(true)}>
          {#if isBusy}
            <LoaderIcon size={13} class="animate-spin" />
          {:else}
            {$t('course.diagram.apply')}
          {/if}
        </Button>
      </div>
    </div>
  {/if}

  {#if warnings.length > 0}
    <div class="pointer-events-auto px-2 pb-2">
      <div class="flex items-start gap-1.5 rounded-md border border-amber-400/60 bg-amber-50 p-2 dark:bg-amber-950/40">
        <AlertTriangleIcon size={13} class="mt-0.5 shrink-0 text-amber-600" />
        <div class="min-w-0 text-[11px] text-amber-900 dark:text-amber-200">
          {#each warnings as warning, i (i)}
            <p class="break-words">{warning}</p>
          {/each}
        </div>
      </div>
    </div>
  {/if}
</div>
