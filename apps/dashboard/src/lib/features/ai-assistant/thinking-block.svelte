<script lang="ts">
  import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
  import BrainIcon from '@lucide/svelte/icons/brain';
  import { t } from '$lib/utils/functions/translations';
  import { renderMarkdown } from '$features/ai-assistant/utils/markdown';

  /**
   * Collapses the agent's step-by-step narration ("Now let me verify the final
   * state of the course…") behind a disclosure, leaving only the actual answer in
   * the bubble.
   *
   * MiniMax-M3 does not emit these as `reasoning` parts — verified against the
   * stored history: 147 `text` parts and zero `reasoning` ones. The deliberation
   * arrives as ordinary assistant text between tool calls, sometimes in English
   * even when the conversation is in Spanish, which is what made it read as the
   * model thinking out loud in the middle of its reply.
   *
   * So the split is structural rather than textual: whatever the model wrote
   * BEFORE its last tool call was said while still working, and belongs in here;
   * what it wrote after is the reply. That rule needs no keyword matching and
   * holds in any language. If real `reasoning` parts ever start arriving (they
   * would, if extended thinking is enabled on the provider), they come here too.
   */
  interface Props {
    /** Narration blocks, in the order the model produced them. */
    blocks: string[];
    /** True while this message is still streaming — shows a live "thinking" state. */
    isStreaming?: boolean;
  }

  let { blocks, isStreaming = false }: Props = $props();

  let expanded = $state(false);
</script>

{#if blocks.length > 0}
  <div class="ui:border-border/60 mt-1 mb-2 rounded-md border border-dashed">
    <button
      type="button"
      class="ui:text-muted-foreground hover:ui:text-foreground flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-xs transition-colors"
      onclick={() => (expanded = !expanded)}
      aria-expanded={expanded}
    >
      <ChevronRightIcon
        size={12}
        class="shrink-0 transition-transform duration-150 {expanded ? 'rotate-90' : ''}"
      />
      <BrainIcon size={12} class="shrink-0 {isStreaming ? 'ui:text-primary animate-pulse' : ''}" />
      <span class="min-w-0 flex-1 truncate">
        {isStreaming
          ? $t('ai_assistant.thinking_active')
          : $t('ai_assistant.thinking_collapsed', { count: blocks.length })}
      </span>
    </button>

    {#if expanded}
      <div class="ui:border-border/60 flex flex-col gap-2 border-t px-3 py-2">
        {#each blocks as block, index (index)}
          <div
            class="ai-chat-prose prose prose-sm dark:prose-invert ui:text-muted-foreground max-w-none break-words text-xs"
          >
            <!-- eslint-disable-next-line svelte/no-at-html-tags -->
            {@html renderMarkdown(block)}
          </div>
        {/each}
      </div>
    {/if}
  </div>
{/if}
