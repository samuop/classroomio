<script lang="ts">
  import { onMount } from 'svelte';
  import { t } from '$lib/utils/functions/translations';
  import { currentOrg } from '$lib/utils/store/org';
  import * as Tabs from '@cio/ui/custom/underline-tabs';
  import { Button } from '@cio/ui/base/button';
  import { Spinner } from '@cio/ui/base/spinner';
  import RefreshIcon from '@lucide/svelte/icons/refresh-cw';
  import BuildingIcon from '@lucide/svelte/icons/building-2';
  import * as Select from '@cio/ui/base/select';
  import { StatusTiles, CourseBreakdown, LearnersTable, complianceApi } from '$features/compliance';
  import type { ComplianceLearnerRow } from '$features/compliance/utils/types';

  /** `TODAS` or one company id. Mirrors the other two tabs of the hub. */
  const TODAS = 'all';
  let empresa = $state<string>(TODAS);

  onMount(() => {
    const orgId = $currentOrg.id;
    if (orgId) complianceApi.ensureFetched(orgId);
  });

  function handleRefresh() {
    const orgId = $currentOrg.id;
    if (!orgId) return;
    complianceApi.fetchOverview(orgId);
  }

  const companies = $derived(complianceApi.overview?.companies ?? []);
  const hasClients = $derived(complianceApi.overview?.hasClients ?? false);
  const showCompany = $derived(companies.length > 1 && empresa === TODAS);

  function nombreEmpresa(id: string) {
    return companies.find((company) => company.id === id)?.name ?? '';
  }

  const cursosVisibles = $derived(
    empresa === TODAS
      ? (complianceApi.overview?.courses ?? [])
      : (complianceApi.overview?.courses ?? []).filter((course) => course.orgId === empresa)
  );
  const alumnosVisibles = $derived(
    empresa === TODAS
      ? (complianceApi.overview?.learners ?? [])
      : (complianceApi.overview?.learners ?? []).filter((learner) => learner.orgId === empresa)
  );

  /**
   * Los mosaicos siguen al filtro. Para una empresa se usan sus propios totales
   * —vienen contados del servidor— en lugar de recontar las filas: `totalLearners`
   * cuenta PERSONAS y la tabla tiene una fila por persona y curso, así que
   * recontar daría un número más alto que la realidad.
   */
  const resumenVisible = $derived.by(() => {
    const overview = complianceApi.overview;
    if (!overview) return null;
    if (empresa === TODAS) return overview;

    const propio = overview.perCompany.find((row) => row.orgId === empresa);

    return {
      ...overview,
      summary: {
        totalLearners: propio?.totalLearners ?? 0,
        totalCourses: cursosVisibles.length,
        counts: propio?.counts ?? overview.summary.counts
      }
    };
  });

  type LearnerStatus = ComplianceLearnerRow['status'];

  const statusFilters: Array<LearnerStatus | 'all'> = [
    'all',
    'compliant',
    'expiring_soon',
    'in_grace_period',
    'non_compliant',
    'in_progress',
    'not_started',
    'waived',
    'no_record'
  ];

  let activeFilter = $state<LearnerStatus | 'all'>('all');
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
    <Button variant="outline" size="sm" disabled={complianceApi.loading} onclick={handleRefresh}>
      <RefreshIcon class={complianceApi.loading ? 'animate-spin' : ''} />
      {$t('analytics.refresh')}
    </Button>
  </div>

  {#if complianceApi.loading && !complianceApi.overview}
    <div class="flex h-32 items-center justify-center">
      <Spinner class="text-muted-foreground size-6" />
    </div>
  {:else}
    <StatusTiles data={resumenVisible} />

    <Tabs.Root value="courses">
      <Tabs.List class="mb-6">
        <Tabs.Trigger value="courses">{$t('compliance.tabs.courses')}</Tabs.Trigger>
        <Tabs.Trigger value="learners">{$t('compliance.tabs.learners')}</Tabs.Trigger>
      </Tabs.List>

      <Tabs.Content value="courses" class="space-y-4">
        <CourseBreakdown rows={cursosVisibles} />
      </Tabs.Content>

      <Tabs.Content value="learners" class="space-y-4">
        <div class="flex flex-wrap gap-2">
          {#each statusFilters as filter (filter)}
            <Button
              variant={activeFilter === filter ? 'default' : 'outline'}
              size="sm"
              onclick={() => (activeFilter = filter)}
            >
              {$t(`compliance.filter.${filter}`)}
            </Button>
          {/each}
        </div>
        <LearnersTable rows={alumnosVisibles} statusFilter={activeFilter} {showCompany} />
      </Tabs.Content>
    </Tabs.Root>
  {/if}
</div>
