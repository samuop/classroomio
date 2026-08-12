<script lang="ts">
  import { Button } from '@cio/ui/base/button';
  import { Input } from '@cio/ui/base/input';
  import LoaderIcon from '@lucide/svelte/icons/loader';
  import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
  import WandSparklesIcon from '@lucide/svelte/icons/wand-sparkles';
  import { t } from '$lib/utils/functions/translations';

  /**
   * Controls over a generated illustration: draw it again, or say what to change.
   *
   * Deliberately the same shape and position as the diagram control — an
   * instructor should not have to learn two vocabularies for "this picture is
   * wrong". The picture is identified by its position among the lesson's images
   * and the server splices the replacement into that exact slot.
   */
  interface Props {
    index: number;
    /** The picture's alt text — what a regeneration works from. */
    alt?: string;
    isBusy?: boolean;
    /** Set when the lesson has unsaved edits: the server rewrites SAVED content. */
    blockedByDraft?: boolean;
    onSubmit: (index: number, instruction?: string) => void | Promise<void>;
  }

  let { index, alt = '', isBusy = false, blockedByDraft = false, onSubmit }: Props = $props();

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
<div class="group/image absolute inset-0 flex flex-col justify-between">
  <div
    class="pointer-events-none flex justify-end p-2 opacity-0 transition-opacity group-hover/image:opacity-100 focus-within:opacity-100"
  >
    <div class="ui:bg-background pointer-events-auto flex items-center gap-1 rounded-md border p-1 shadow-sm">
      {#if blockedByDraft}
        <span class="ui:text-muted-foreground px-2 text-xs">{$t('course.diagram.save_first')}</span>
      {:else}
        <Button variant="ghost" size="sm" {disabled} onclick={() => submit(false)} title={$t('course.image.regenerate')}>
          {#if isBusy}
            <LoaderIcon size={13} class="animate-spin" />
          {:else}
            <RefreshCwIcon size={13} />
          {/if}
          <span class="ml-1 text-xs">{$t('course.image.regenerate')}</span>
        </Button>
        <Button variant="ghost" size="sm" {disabled} onclick={() => (expanded = !expanded)} title={$t('course.image.ask_change')}>
          <WandSparklesIcon size={13} />
        </Button>
      {/if}
    </div>
  </div>

  {#if expanded && !blockedByDraft}
    <div class="pointer-events-auto p-2">
      <div class="ui:bg-background flex flex-col gap-1 rounded-md border p-1 shadow-sm">
        {#if alt}
          <!-- What it is currently of, so a change is written against something
               rather than from memory of a picture the teacher is looking at. -->
          <p class="ui:text-muted-foreground line-clamp-2 px-1 text-[11px]">{alt}</p>
        {/if}
        <div class="flex items-center gap-1">
          <Input
            bind:value={instruction}
            placeholder={$t('course.image.ask_change_placeholder')}
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
              {$t('course.image.apply')}
            {/if}
          </Button>
        </div>
      </div>
    </div>
  {/if}
</div>
