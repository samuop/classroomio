<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { t } from '$lib/utils/functions/translations';
  import { currentOrg, currentOrgPath } from '$lib/utils/store/org';
  import { downloadCSV } from '$lib/utils/functions/download-csv';
  import { Button } from '@cio/ui/base/button';
  import { Spinner } from '@cio/ui/base/spinner';
  import RefreshIcon from '@lucide/svelte/icons/refresh-cw';
  import DownloadIcon from '@lucide/svelte/icons/download';
  import { SummaryTiles, LearnersTable, atRiskApi } from '$features/at-risk';
  import type { AtRiskReason } from '$features/at-risk/utils/types';

  onMount(() => {
    const orgId = $currentOrg.id;
    if (orgId) atRiskApi.ensureFetched(orgId);
  });

  function handleRefresh() {
    const orgId = $currentOrg.id;
    if (!orgId) return;
    atRiskApi.fetchOverview(orgId);
  }

  const reasonFilters: Array<AtRiskReason | 'all'> = ['all', 'inactive', 'low_progress', 'low_grade', 'compliance'];
  let activeFilter = $state<AtRiskReason | 'all'>('all');

  function reasonsLabel(reasons: AtRiskReason[]) {
    return reasons.map((reason) => $t(`at_risk.reason.${reason}`)).join(', ');
  }

  function exportCSV() {
    const learners = atRiskApi.overview?.learners ?? [];
    if (learners.length === 0) return;

    const rows = learners.map((learner) => ({
      [$t('at_risk.learners.learner')]: learner.fullname || learner.email,
      [$t('at_risk.export.email')]: learner.email,
      [$t('at_risk.export.days_since_activity')]: learner.daysSinceActivity ?? '',
      [$t('at_risk.learners.progress')]: `${learner.averageProgress}%`,
      [$t('at_risk.learners.grade')]: `${learner.averageGrade}%`,
      [$t('at_risk.learners.reasons')]: reasonsLabel(learner.reasons)
    }));

    const siteName = $currentOrg.siteName ?? 'org';
    downloadCSV(rows, `${siteName}-alumnos-en-riesgo`);
  }

  // Clicking a learner opens their 360 profile (the link the old page lacked).
  function openProfile(profileId: string) {
    goto(`${$currentOrgPath}/students/${profileId}`);
  }
</script>

<div class="space-y-6">
  <div class="flex justify-end gap-2">
    <Button
      variant="outline"
      size="sm"
      disabled={!atRiskApi.overview || (atRiskApi.overview?.learners.length ?? 0) === 0}
      onclick={exportCSV}
    >
      <DownloadIcon />
      {$t('at_risk.export.button')}
    </Button>
    <Button variant="outline" size="sm" disabled={atRiskApi.loading} onclick={handleRefresh}>
      <RefreshIcon class={atRiskApi.loading ? 'animate-spin' : ''} />
      {$t('analytics.refresh')}
    </Button>
  </div>

  {#if atRiskApi.loading && !atRiskApi.overview}
    <div class="flex h-32 items-center justify-center">
      <Spinner class="text-muted-foreground size-6" />
    </div>
  {:else}
    <SummaryTiles data={atRiskApi.overview} />

    <div class="flex flex-wrap gap-2">
      {#each reasonFilters as filter (filter)}
        <Button
          variant={activeFilter === filter ? 'default' : 'outline'}
          size="sm"
          onclick={() => (activeFilter = filter)}
        >
          {$t(`at_risk.filter.${filter}`)}
        </Button>
      {/each}
    </div>

    <LearnersTable
      rows={atRiskApi.overview?.learners ?? []}
      reasonFilter={activeFilter}
      onRowClick={openProfile}
    />
  {/if}
</div>
