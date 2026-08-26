<script lang="ts">
  import { t } from '$lib/utils/functions/translations';
  import * as Card from '@cio/ui/base/card';
  import { SvelteDate } from 'svelte/reactivity';
  import type { AiUsageData, PurchasedSummaryData } from '$features/settings/utils/types';
  import { porcentajeDeCupo } from '$lib/utils/ai-usage';
  import { isPlatformAdmin } from '$lib/utils/store/user';

  interface Props {
    usage: AiUsageData | null;
    purchased: PurchasedSummaryData | null;
  }

  let { usage, purchased }: Props = $props();

  const porcentaje = $derived(usage ? porcentajeDeCupo(usage.used, usage.allowance) : null);
  /** Para la barra hace falta un número sí o sí; `null` se dibuja como vacía. */
  const includedPercent = $derived(porcentaje ?? 0);

  const resetDate = $derived.by(() => {
    const nextReset = new SvelteDate();
    nextReset.setMonth(nextReset.getMonth() + 1);
    nextReset.setDate(1);

    return nextReset.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  });
</script>

<div class="grid grid-cols-1 gap-4">
  <Card.Root>
    <Card.Header>
      <Card.Description>{$t('settings.ai_credits.included.title')}</Card.Description>
      <!--
        Sólo el super-admin de la plataforma ve fichas; cualquier admin de
        empresa ve el porcentaje. Ojo: el cupo TAMPOCO se muestra, porque con el
        porcentaje y el cupo a la vista el número consumido se despeja solo.
      -->
      <Card.Title class="text-2xl">
        {#if usage && $isPlatformAdmin}
          {usage.used.toLocaleString()} / {usage.allowance.toLocaleString()}
        {:else if porcentaje !== null}
          {$t('settings.ai_credits.percent_of_quota', { pct: porcentaje })}
        {:else}
          —
        {/if}
      </Card.Title>
    </Card.Header>
    <Card.Content>
      <p class="ui:text-muted-foreground mb-3 text-xs">
        {$t('settings.ai_credits.included.subtitle')}
      </p>
      <div class="ui:bg-muted h-2 w-full rounded-full">
        <div
          class="h-2 rounded-full transition-all {includedPercent > 90
            ? 'bg-red-500'
            : includedPercent > 70
              ? 'bg-amber-500'
              : 'ui:bg-primary'}"
          style="width: {includedPercent}%"
        ></div>
      </div>
      <p class="ui:text-muted-foreground mt-2 text-xs">
        {$t('settings.ai_credits.included.resets_on', { date: resetDate })}
      </p>
    </Card.Content>
  </Card.Root>

  <!-- "Uso comprado" card removed: no in-app token purchases in this
       deployment. AI budget is set per-org via aiTokenAllowance. -->
</div>
