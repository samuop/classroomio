<script lang="ts">
  import { CircularProgress } from '@cio/ui/custom/circular-progress';
  import { Tooltip, Provider, Trigger, Content } from '@cio/ui/base/tooltip';
  import { t } from '$lib/utils/functions/translations';
  import { formatTokenCount, type ContextUsage } from './utils/context-utils';

  interface Props {
    contextUsage: ContextUsage;
  }

  let { contextUsage }: Props = $props();

  const progressClass = $derived(
    contextUsage.isFull ? 'ui:stroke-destructive' : contextUsage.isNearlyFull ? 'stroke-amber-500' : 'ui:stroke-primary'
  );

  const tooltipText = $derived(
    t.get('ai_assistant.context_usage_tooltip', {
      used: formatTokenCount(contextUsage.usedTokens),
      max: formatTokenCount(contextUsage.maxTokens)
    })
  );

  /**
   * Occupancy alone is not actionable: the sources are re-sent in full every
   * turn, so most of a near-full window is usually untouchable by compaction.
   * Splitting the number is what tells the teacher whether compacting is the
   * lever, or whether the course simply carries too much material.
   */
  const breakdownLines = $derived.by(() => {
    if (contextUsage.compactableTokens === undefined || contextUsage.fixedTokens === undefined) {
      return [];
    }

    const lines = [t.get('ai_assistant.context_fixed', { tokens: formatTokenCount(contextUsage.fixedTokens) })];

    // Named separately from the rest of the fixed cost because it is the part
    // that moves: the pack is left out of a single-lesson edit, so the same
    // conversation reads 70% on one turn and 13% on the next. Naming it is what
    // turns an alarming jump into an explicable one.
    if (contextUsage.sourcesTokens) {
      lines.push(
        t.get('ai_assistant.context_sources', { tokens: formatTokenCount(contextUsage.sourcesTokens) })
      );
    }

    lines.push(
      t.get('ai_assistant.context_conversation', {
        tokens: formatTokenCount(contextUsage.compactableTokens)
      })
    );

    return lines;
  });
</script>

<Provider>
  <Tooltip>
    <Trigger>
      <button
        type="button"
        class="ui:text-muted-foreground hover:ui:bg-muted flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs transition-colors"
      >
        <CircularProgress
          value={contextUsage.percentage}
          size={16}
          strokeWidth={2}
          {progressClass}
          trackClass="ui:stroke-muted"
        />
        <span>{contextUsage.percentage}%</span>
      </button>
    </Trigger>
    <Content side="top">
      <p class="text-xs">{tooltipText}</p>
      {#each breakdownLines as line (line)}
        <p class="ui:text-muted-foreground text-xs">{line}</p>
      {/each}
    </Content>
  </Tooltip>
</Provider>
