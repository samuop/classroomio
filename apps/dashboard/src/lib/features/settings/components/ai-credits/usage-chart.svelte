<script lang="ts">
  import * as Chart from '@cio/ui/base/chart';
  import { t } from '$lib/utils/functions/translations';
  import type { AiUsageData } from '$features/settings/utils/types';
  import { porcentajeDeCupo } from '$lib/utils/ai-usage';
  import { isPlatformAdmin } from '$lib/utils/store/user';

  interface Props {
    usage: AiUsageData | null;
  }

  let { usage }: Props = $props();

  const historial = $derived(usage?.history ?? []);
  const cupo = $derived(usage?.allowance ?? 0);

  /**
   * Las barras, en fichas o en porcentaje del cupo mensual.
   *
   * La transformación es lineal, así que **las barras conservan exactamente su
   * altura relativa**: el gráfico sigue contando lo mismo (qué días se gastó
   * más), sólo cambia la unidad del eje.
   *
   * Un decimal y no entero: un día suele comerse menos del 1% del mes, y
   * redondeando a entero todas las barras marcarían 0 y el tooltip dejaría de
   * decir nada.
   */
  const data = $derived(
    $isPlatformAdmin || cupo <= 0
      ? historial
      : historial.map((dia) => ({ ...dia, tokens: Math.round((dia.tokens / cupo) * 1000) / 10 }))
  );

  const totalCrudo = $derived(historial.reduce((sum, day) => sum + day.tokens, 0));
  const totalPorcentaje = $derived(porcentajeDeCupo(totalCrudo, cupo));
  const totalRequests = $derived(usage?.requestsThisMonth ?? 0);

  const chartConfig = $derived({
    tokens: {
      label: $isPlatformAdmin ? $t('settings.ai_credits.chart.tokens') : $t('settings.ai_credits.chart.tokens_percent'),
      color: 'var(--chart-1)'
    }
  } satisfies Chart.ChartConfig);

  const series = $derived([
    { key: 'tokens', value: 'tokens', label: chartConfig.tokens.label, color: 'var(--color-tokens)' }
  ]);

  // Sobre el historial CRUDO y no sobre `data`: un día de consumo chico redondea
  // a 0,0% y, midiendo ahí, el gráfico diría "todavía no hay uso" cuando sí lo
  // hubo. La conversión a porcentaje es para mostrar, no para decidir.
  const hasData = $derived(historial.some((day) => day.tokens > 0));
</script>

<div class="bg-card flex flex-col rounded-xl border p-3 md:p-5 dark:text-white">
  <div class="mb-4 flex flex-wrap items-start justify-between gap-4">
    <div>
      <h3 class="text-lg font-semibold tracking-tight">{$t('settings.ai_credits.chart.heading')}</h3>
      <p class="ui:text-muted-foreground mt-1 text-sm">
        {$t('settings.ai_credits.chart.subheading')}
      </p>
    </div>
    <div class="flex flex-wrap gap-6 text-right">
      <div>
        <p class="ui:text-muted-foreground text-xs">
          {$isPlatformAdmin
            ? $t('settings.ai_credits.chart.total_tokens')
            : $t('settings.ai_credits.chart.total_percent')}
        </p>
        <p class="text-xl font-semibold">
          {#if $isPlatformAdmin}
            {totalCrudo.toLocaleString()}
          {:else if totalPorcentaje !== null}
            {totalPorcentaje}%
          {:else}
            —
          {/if}
        </p>
      </div>
      <div>
        <p class="ui:text-muted-foreground text-xs">{$t('settings.ai_credits.chart.total_requests')}</p>
        <p class="text-xl font-semibold">{totalRequests.toLocaleString()}</p>
      </div>
    </div>
  </div>

  {#if hasData}
    <Chart.ChartContainer class="h-[260px] w-full" config={chartConfig}>
      <Chart.BarChart {data} x="date" axis="x" {series} />
    </Chart.ChartContainer>
  {:else}
    <div class="ui:text-muted-foreground flex h-[260px] items-center justify-center text-sm">
      {$t('settings.ai_credits.chart.empty')}
    </div>
  {/if}
</div>
