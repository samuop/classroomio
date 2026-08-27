<script lang="ts">
  import { CircularProgress } from '@cio/ui/custom/circular-progress';
  import { Tooltip, Provider, Trigger, Content } from '@cio/ui/base/tooltip';
  import { t } from '$lib/utils/functions/translations';
  import { formatTokenCount, type ContextUsage } from './utils/context-utils';
  import { isPlatformAdmin } from '$lib/utils/store/user';

  interface Props {
    contextUsage: ContextUsage;
  }

  let { contextUsage }: Props = $props();

  const progressClass = $derived(
    contextUsage.isFull ? 'ui:stroke-destructive' : contextUsage.isNearlyFull ? 'stroke-amber-500' : 'ui:stroke-primary'
  );

  /**
   * Una línea, que nombra lo que el número mide y nada más.
   *
   * Antes el tooltip desglosaba fijo / fuentes / conversación para que se
   * entendiera si compactar servía de algo. Se sacó por pedido: explicar la
   * mecánica del contexto en un globo de ayuda le pide al docente cargar con
   * algo que no decide nada de lo que va a hacer después.
   */
  const tooltipText = $derived(
    $isPlatformAdmin
      ? t.get('ai_assistant.context_usage_tooltip', {
          used: formatTokenCount(contextUsage.usedTokens),
          max: formatTokenCount(contextUsage.maxTokens)
        })
      : t.get('ai_assistant.context_usage_tooltip_pct', { pct: contextUsage.percentage })
  );
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
    </Content>
  </Tooltip>
</Provider>
