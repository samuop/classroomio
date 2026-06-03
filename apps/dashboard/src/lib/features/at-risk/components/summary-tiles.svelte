<script lang="ts">
  import * as Card from '@cio/ui/base/card';
  import { cn } from '@cio/ui/tools';
  import { t } from '$lib/utils/functions/translations';
  import UsersIcon from '@lucide/svelte/icons/users';
  import AlertTriangleIcon from '@lucide/svelte/icons/alert-triangle';
  import MoonIcon from '@lucide/svelte/icons/moon';
  import TrendingDownIcon from '@lucide/svelte/icons/trending-down';
  import GraduationCapIcon from '@lucide/svelte/icons/graduation-cap';
  import ShieldOffIcon from '@lucide/svelte/icons/shield-off';
  import type { Component } from 'svelte';
  import type { AtRiskOverviewData, AtRiskReason } from '../utils/types';

  interface Props {
    data: AtRiskOverviewData | null;
  }

  let { data }: Props = $props();

  type Tile = {
    value: number;
    labelKey: string;
    icon: Component;
    tone: 'info' | 'danger' | 'warning' | 'muted';
  };

  const reasonTiles: Array<{ key: AtRiskReason; labelKey: string; icon: Component }> = [
    { key: 'inactive', labelKey: 'at_risk.reason.inactive', icon: MoonIcon },
    { key: 'low_progress', labelKey: 'at_risk.reason.low_progress', icon: TrendingDownIcon },
    { key: 'low_grade', labelKey: 'at_risk.reason.low_grade', icon: GraduationCapIcon },
    { key: 'compliance', labelKey: 'at_risk.reason.compliance', icon: ShieldOffIcon }
  ];

  const tiles = $derived<Tile[]>([
    {
      value: data?.summary.totalStudents ?? 0,
      labelKey: 'at_risk.tiles.total_students',
      icon: UsersIcon,
      tone: 'info'
    },
    {
      value: data?.summary.atRiskCount ?? 0,
      labelKey: 'at_risk.tiles.at_risk',
      icon: AlertTriangleIcon,
      tone: 'danger'
    },
    ...reasonTiles.map(
      (reason): Tile => ({
        value: data?.summary.byReason[reason.key] ?? 0,
        labelKey: reason.labelKey,
        icon: reason.icon,
        tone: 'warning'
      })
    )
  ]);

  const toneClass: Record<Tile['tone'], string> = {
    info: 'ui:bg-primary/10 ui:text-primary',
    danger: 'bg-rose-500/10 text-rose-600 dark:text-rose-400',
    warning: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
    muted: 'ui:bg-muted ui:text-muted-foreground'
  };
</script>

<Card.Root class="ui:bg-card">
  <Card.Header class="pb-2">
    <Card.Title class="text-base font-semibold">{$t('at_risk.summary.heading')}</Card.Title>
    <Card.Description>{$t('at_risk.summary.description')}</Card.Description>
  </Card.Header>
  <Card.Content class="pt-0">
    <div class="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-6">
      {#each tiles as tile (tile.labelKey)}
        <div class="flex min-w-0 flex-col gap-2">
          <div class={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-full', toneClass[tile.tone])}>
            <tile.icon class="h-4 w-4" />
          </div>
          <p class="ui:text-foreground text-2xl font-semibold tabular-nums">{tile.value}</p>
          <p class="ui:text-muted-foreground text-xs leading-snug">{$t(tile.labelKey)}</p>
        </div>
      {/each}
    </div>
  </Card.Content>
</Card.Root>
