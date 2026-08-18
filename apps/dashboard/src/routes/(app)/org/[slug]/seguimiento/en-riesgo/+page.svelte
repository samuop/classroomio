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
  import * as Select from '@cio/ui/base/select';
  import BuildingIcon from '@lucide/svelte/icons/building-2';
  import { SummaryTiles, LearnersTable, atRiskApi } from '$features/at-risk';
  import type { AtRiskReason } from '$features/at-risk/utils/types';

  /** `TODAS` or one company id. Mirrors the Resumen tab's picker. */
  const TODAS = 'all';
  let empresa = $state<string>(TODAS);

  onMount(() => {
    const orgId = $currentOrg.id;
    if (orgId) atRiskApi.ensureFetched(orgId);
  });

  function handleRefresh() {
    const orgId = $currentOrg.id;
    if (!orgId) return;
    atRiskApi.fetchOverview(orgId);
  }

  const companies = $derived(atRiskApi.overview?.companies ?? []);
  const hasClients = $derived(atRiskApi.overview?.hasClients ?? false);

  // Filtered here rather than refetched: every row already says which company
  // it came from, so the answer is in hand.
  const enRiesgo = $derived(
    empresa === TODAS
      ? (atRiskApi.overview?.learners ?? [])
      : (atRiskApi.overview?.learners ?? []).filter((learner) => learner.orgId === empresa)
  );

  const showCompany = $derived(companies.length > 1 && empresa === TODAS);

  function nombreEmpresa(id: string) {
    return companies.find((company) => company.id === id)?.name ?? '';
  }

  /**
   * The tiles have to follow the filter too.
   *
   * `byReason` counts a learner once per signal, so it cannot be recovered from
   * the summary by subtraction — it is recounted from the visible rows, which is
   * also the only way the six numbers keep adding up against the table below.
   */
  const resumenVisible = $derived.by(() => {
    const overview = atRiskApi.overview;
    if (!overview) return null;

    if (empresa === TODAS) return overview;

    const byReason = { inactive: 0, low_progress: 0, low_grade: 0, compliance: 0 };
    for (const learner of enRiesgo) {
      for (const reason of learner.reasons) byReason[reason] += 1;
    }

    return {
      ...overview,
      summary: {
        // Total de la empresa elegida: no se puede recontar de las filas, que
        // solo traen a los marcados. Viene del recuento por empresa del server.
        totalStudents: overview.perCompany.find((row) => row.orgId === empresa)?.totalStudents ?? enRiesgo.length,
        atRiskCount: enRiesgo.length,
        byReason
      }
    };
  });

  const reasonFilters: Array<AtRiskReason | 'all'> = ['all', 'inactive', 'low_progress', 'low_grade', 'compliance'];
  let activeFilter = $state<AtRiskReason | 'all'>('all');

  function reasonsLabel(reasons: AtRiskReason[]) {
    return reasons.map((reason) => $t(`at_risk.reason.${reason}`)).join(', ');
  }

  function exportCSV() {
    const learners = enRiesgo;
    if (learners.length === 0) return;

    const rows = learners.map((learner) => ({
      [$t('at_risk.learners.learner')]: learner.fullname || learner.email,
      [$t('at_risk.export.email')]: learner.email,
      // Always exported, even when the column is hidden: a spreadsheet outlives
      // the screen it came from and "which company" is the first thing asked.
      [$t('tracking.col_company')]: learner.orgName,
      [$t('at_risk.export.days_since_activity')]: learner.daysSinceActivity ?? '',
      [$t('at_risk.learners.progress')]: `${learner.averageProgress}%`,
      [$t('at_risk.learners.grade')]: `${learner.averageGrade}%`,
      [$t('at_risk.learners.reasons')]: reasonsLabel(learner.reasons)
    }));

    const siteName = $currentOrg.siteName ?? 'org';
    downloadCSV(rows, `${siteName}-alumnos-en-riesgo`);
  }

  // Clicking a learner opens their 360 profile (the link the old page lacked).
  // The company rides along: the record lives in the learner's company.
  function openProfile(profileId: string, orgId: string) {
    goto(`${$currentOrgPath}/students/${profileId}?org=${orgId}`);
  }
</script>

<div class="space-y-6">
  <div class="flex flex-wrap items-center justify-between gap-2">
    {#if hasClients}
      <div class="flex items-center gap-2">
        <BuildingIcon class="ui:text-muted-foreground size-4 shrink-0" />
        <Select.Root type="single" value={empresa} onValueChange={(value) => (empresa = value)}>
          <Select.Trigger class="ui:h-9 ui:min-w-56">
            {empresa === TODAS ? $t('tracking.scope_all') : nombreEmpresa(empresa)}
          </Select.Trigger>
          <Select.Content>
            <Select.Item value={TODAS}>{$t('tracking.scope_all')}</Select.Item>
            {#each companies as company (company.id)}
              <Select.Item value={company.id}>{company.name}</Select.Item>
            {/each}
          </Select.Content>
        </Select.Root>
      </div>
    {:else}
      <span></span>
    {/if}

    <div class="flex gap-2">
    <Button
      variant="outline"
      size="sm"
      disabled={enRiesgo.length === 0}
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
  </div>

  {#if atRiskApi.loading && !atRiskApi.overview}
    <div class="flex h-32 items-center justify-center">
      <Spinner class="text-muted-foreground size-6" />
    </div>
  {:else}
    <SummaryTiles data={resumenVisible} />

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
      rows={enRiesgo}
      reasonFilter={activeFilter}
      {showCompany}
      onRowClick={openProfile}
    />
  {/if}
</div>
