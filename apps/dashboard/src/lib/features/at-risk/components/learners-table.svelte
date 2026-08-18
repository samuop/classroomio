<script lang="ts">
  import * as Card from '@cio/ui/base/card';
  import * as Table from '@cio/ui/base/table';
  import { Badge } from '@cio/ui/base/badge';
  import { Empty } from '@cio/ui/custom/empty';
  import { UserAvatar } from '@cio/ui/custom/user-avatar';
  import UsersIcon from '@lucide/svelte/icons/users';
  import { t } from '$lib/utils/functions/translations';
  import type { AtRiskLearnerRow, AtRiskReason } from '../utils/types';

  interface Props {
    rows: AtRiskLearnerRow[];
    reasonFilter?: AtRiskReason | 'all';
    /**
     * Show which company each learner belongs to. Only worth the column when the
     * list spans several — inside one company it repeats the same name.
     */
    showCompany?: boolean;
    /**
     * When set, each row is clickable and opens that learner's 360 profile. The
     * company travels with it: the record lives in the learner's company, which
     * is not necessarily the one being viewed.
     */
    onRowClick?: (profileId: string, orgId: string) => void;
  }

  let { rows, reasonFilter = 'all', showCompany = false, onRowClick }: Props = $props();

  const filtered = $derived(
    reasonFilter === 'all' ? rows : rows.filter((row) => row.reasons.includes(reasonFilter as AtRiskReason))
  );

  const reasonTone: Record<AtRiskReason, string> = {
    inactive: 'ui:bg-muted ui:text-muted-foreground',
    low_progress: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
    low_grade: 'bg-rose-500/10 text-rose-700 dark:text-rose-300',
    compliance: 'bg-rose-500/10 text-rose-700 dark:text-rose-300'
  };

  function reasonLabel(reason: AtRiskReason) {
    return $t(`at_risk.reason.${reason}`);
  }

  function formatActivity(daysSinceActivity: number | null) {
    if (daysSinceActivity === null) return $t('at_risk.table.never_active');
    if (daysSinceActivity === 0) return $t('at_risk.table.today');
    return $t('at_risk.table.days_ago', { count: daysSinceActivity });
  }
</script>

<Card.Root>
  <Card.Header>
    <Card.Title>{$t('at_risk.learners.heading')}</Card.Title>
    <Card.Description>
      {$t('at_risk.learners.subtitle', { count: filtered.length })}
    </Card.Description>
  </Card.Header>
  <Card.Content>
    {#if filtered.length === 0}
      <Empty icon={UsersIcon} title={$t('at_risk.learners.empty')} />
    {:else}
      <Table.Root>
        <Table.Header>
          <Table.Row>
            <Table.Head>{$t('at_risk.learners.learner')}</Table.Head>
            {#if showCompany}
              <Table.Head>{$t('tracking.col_company')}</Table.Head>
            {/if}
            <Table.Head>{$t('at_risk.learners.last_activity')}</Table.Head>
            <Table.Head>{$t('at_risk.learners.progress')}</Table.Head>
            <Table.Head>{$t('at_risk.learners.grade')}</Table.Head>
            <Table.Head>{$t('at_risk.learners.reasons')}</Table.Head>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {#each filtered as row (`${row.orgId}:${row.profileId}`)}
            <Table.Row
              class={onRowClick ? 'ui:cursor-pointer' : ''}
              onclick={onRowClick ? () => onRowClick(row.profileId, row.orgId) : undefined}
            >
              <Table.Cell>
                <div class="flex items-center gap-2">
                  <UserAvatar src={row.avatarUrl} alt={row.fullname ?? row.email ?? 'Learner'} class="h-7 w-7" />
                  <div class="min-w-0">
                    <p class="ui:text-foreground truncate text-sm font-medium">{row.fullname || '—'}</p>
                    <p class="ui:text-muted-foreground truncate text-xs">{row.email}</p>
                  </div>
                </div>
              </Table.Cell>
              {#if showCompany}
                <Table.Cell class="ui:text-muted-foreground text-sm">{row.orgName}</Table.Cell>
              {/if}
              <Table.Cell class="ui:text-muted-foreground text-sm">{formatActivity(row.daysSinceActivity)}</Table.Cell>
              <Table.Cell class="text-sm tabular-nums">{row.averageProgress}%</Table.Cell>
              <Table.Cell class="text-sm tabular-nums">{row.averageGrade}%</Table.Cell>
              <Table.Cell>
                <div class="flex flex-wrap gap-1">
                  {#each row.reasons as reason (reason)}
                    <Badge variant="outline" class={reasonTone[reason]}>{reasonLabel(reason)}</Badge>
                  {/each}
                </div>
              </Table.Cell>
            </Table.Row>
          {/each}
        </Table.Body>
      </Table.Root>
    {/if}
  </Card.Content>
</Card.Root>
