<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { t } from '$lib/utils/functions/translations';
  import { currentOrg, currentOrgPath } from '$lib/utils/store/org';
  import { shortenName } from '$lib/utils/functions/string';
  import { Spinner } from '@cio/ui/base/spinner';
  import * as Avatar from '@cio/ui/base/avatar';
  import { trackingApi } from '$features/tracking/api/tracking.svelte';
  import type { TrackingAxis, TrackingStatus } from '$features/tracking/utils/types';

  let axis = $state<TrackingAxis>('student');

  onMount(() => {
    const orgId = $currentOrg.id;
    if (orgId) trackingApi.ensureFetched(orgId);
  });

  const overview = $derived(trackingApi.overview);

  function statusClass(status: TrackingStatus): string {
    if (status === 'at_risk') return 'pill-crit';
    if (status === 'attention') return 'pill-warn';
    return 'pill-ok';
  }
  function statusLabel(status: TrackingStatus): string {
    if (status === 'at_risk') return $t('tracking.status_at_risk');
    if (status === 'attention') return $t('tracking.status_attention');
    return $t('tracking.status_ok');
  }
  function barColor(pct: number): string {
    if (pct >= 70) return 'var(--tracking-ok)';
    if (pct >= 40) return 'var(--tracking-warn)';
    return 'var(--tracking-crit)';
  }
  function activityLabel(days: number | null): string {
    if (days === null) return $t('tracking.never_active');
    if (days <= 0) return $t('tracking.today');
    return $t('tracking.days_ago', { count: days });
  }
  function openProfile(profileId: string) {
    goto(`${$currentOrgPath}/students/${profileId}`);
  }
</script>

<div class="tracking">
  {#if trackingApi.loading && !overview}
    <div class="flex h-40 items-center justify-center">
      <Spinner class="text-muted-foreground size-6" />
    </div>
  {:else if overview}
    <!-- axis switch -->
    <div class="axis-switch" role="group" aria-label={$t('tracking.title')}>
      <button type="button" aria-pressed={axis === 'student'} onclick={() => (axis = 'student')}>
        👤 {$t('tracking.axis_student')}
      </button>
      <button type="button" aria-pressed={axis === 'course'} onclick={() => (axis = 'course')}>
        📚 {$t('tracking.axis_course')}
      </button>
    </div>

    {#if axis === 'student'}
      <!-- ============ POR ALUMNO ============ -->
      <div class="kpis">
        <div class="kpi s-accent">
          <div class="k-label">{$t('tracking.kpi_students')}</div>
          <div class="k-val num">{overview.summary.totalStudents}</div>
          <div class="k-sub">{$t('tracking.kpi_students_sub', { count: overview.summary.totalCourses })}</div>
        </div>
        <div class="kpi s-warn">
          <div class="k-label">{$t('tracking.kpi_avg_progress')}</div>
          <div class="k-val num">{overview.summary.averageProgress}<small>%</small></div>
          <div class="k-sub">{$t('tracking.kpi_avg_progress_sub')}</div>
        </div>
        <div class="kpi s-crit">
          <div class="k-label">{$t('tracking.kpi_at_risk')}</div>
          <div class="k-val num">{overview.summary.atRiskCount}</div>
          <div class="k-sub">{$t('tracking.kpi_at_risk_sub', { total: overview.summary.totalStudents })}</div>
        </div>
        <div class="kpi s-ok">
          <div class="k-label">{$t('tracking.kpi_enrolments')}</div>
          <div class="k-val num">{overview.summary.enrolmentsPerStudent}</div>
          <div class="k-sub">{$t('tracking.kpi_enrolments_sub')}</div>
        </div>
      </div>

      {#if overview.byStudent.length === 0}
        <p class="empty">{$t('tracking.empty_students')}</p>
      {:else}
        <div class="tbl-wrap">
          <table>
            <thead>
              <tr>
                <th>{$t('tracking.col_student')}</th>
                <th>{$t('tracking.col_courses')}</th>
                <th>{$t('tracking.col_progress')}</th>
                <th>{$t('tracking.col_grade')}</th>
                <th>{$t('tracking.col_activity')}</th>
                <th>{$t('tracking.col_status')}</th>
              </tr>
            </thead>
            <tbody>
              {#each overview.byStudent as s (s.profileId)}
                <tr
                  class="clickable"
                  onclick={() => openProfile(s.profileId)}
                  title={$t('tracking.view_profile')}
                >
                  <td>
                    <div class="learner">
                      <Avatar.Root class="size-8">
                        <Avatar.Image src={s.avatarUrl} alt={s.fullname} />
                        <Avatar.Fallback class="text-xs">{shortenName(s.fullname || s.email)}</Avatar.Fallback>
                      </Avatar.Root>
                      <div class="who">
                        <div class="nm">{s.fullname || s.email}</div>
                        <div class="em">{s.email}</div>
                      </div>
                    </div>
                  </td>
                  <td class="num">{$t('tracking.courses_count', { count: s.coursesCount })}</td>
                  <td>
                    <div class="mini">
                      <div class="bar">
                        <span style="width:{s.averageProgress}%; background:{barColor(s.averageProgress)}"></span>
                      </div>
                      <span class="pct num">{s.averageProgress}%</span>
                    </div>
                  </td>
                  <td class="num">{s.averageGrade > 0 ? `${s.averageGrade}%` : $t('tracking.no_grade')}</td>
                  <td class="num muted">{activityLabel(s.daysSinceActivity)}</td>
                  <td><span class="pill {statusClass(s.status)}">{statusLabel(s.status)}</span></td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    {:else}
      <!-- ============ POR CURSO ============ -->
      <div class="kpis">
        <div class="kpi s-accent">
          <div class="k-label">{$t('tracking.kpi_courses')}</div>
          <div class="k-val num">{overview.byCourse.length}</div>
          <div class="k-sub">{$t('tracking.kpi_courses_sub')}</div>
        </div>
        <div class="kpi s-warn">
          <div class="k-label">{$t('tracking.kpi_avg_progress_course')}</div>
          <div class="k-val num">{overview.summary.averageProgress}<small>%</small></div>
          <div class="k-sub">{$t('tracking.kpi_avg_progress_course_sub')}</div>
        </div>
        <div class="kpi s-crit">
          <div class="k-label">{$t('tracking.kpi_at_risk')}</div>
          <div class="k-val num">{overview.summary.atRiskCount}</div>
          <div class="k-sub">{$t('tracking.kpi_at_risk_sub', { total: overview.summary.totalStudents })}</div>
        </div>
        <div class="kpi s-ok">
          <div class="k-label">{$t('tracking.kpi_students')}</div>
          <div class="k-val num">{overview.summary.totalStudents}</div>
          <div class="k-sub">{$t('tracking.kpi_enrolments_sub')}</div>
        </div>
      </div>

      {#if overview.byCourse.length === 0}
        <p class="empty">{$t('tracking.empty_courses')}</p>
      {:else}
        <div class="tbl-wrap">
          <table>
            <thead>
              <tr>
                <th>{$t('tracking.col_course')}</th>
                <th>{$t('tracking.col_enrolled')}</th>
                <th>{$t('tracking.col_avg_progress')}</th>
                <th>{$t('tracking.col_grade')}</th>
                <th>{$t('tracking.col_completed')}</th>
              </tr>
            </thead>
            <tbody>
              {#each overview.byCourse as c (c.courseId)}
                <tr>
                  <td class="ct">{c.courseTitle}</td>
                  <td class="num">{c.enrolledCount}</td>
                  <td>
                    <div class="mini">
                      <div class="bar">
                        <span style="width:{c.averageProgress}%; background:{barColor(c.averageProgress)}"></span>
                      </div>
                      <span class="pct num">{c.averageProgress}%</span>
                    </div>
                  </td>
                  <td class="num">{c.averageGrade > 0 ? `${c.averageGrade}%` : $t('tracking.no_grade')}</td>
                  <td class="num">{c.completedCount}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    {/if}
  {/if}
</div>

<style>
  .tracking {
    /* semantic tracking colors (separate from the app accent) */
    --tracking-ok: #12a150;
    --tracking-warn: #c77700;
    --tracking-crit: #d92d20;
  }
  :global(.dark) .tracking {
    --tracking-ok: #34c775;
    --tracking-warn: #e8a13b;
    --tracking-crit: #f0685a;
  }

  .axis-switch {
    display: inline-flex;
    gap: 2px;
    padding: 3px;
    margin-bottom: 20px;
    border: 1px solid var(--border, #e5e7eb);
    border-radius: 9px;
    background: var(--muted, #f3f4f6);
  }
  .axis-switch button {
    appearance: none;
    border: none;
    background: none;
    font: inherit;
    font-size: 13px;
    font-weight: 600;
    color: var(--muted-foreground, #6b7280);
    padding: 6px 14px;
    border-radius: 6px;
    cursor: pointer;
  }
  .axis-switch button[aria-pressed='true'] {
    background: var(--background, #fff);
    color: var(--primary, #3b5bff);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
  }
  .axis-switch button:focus-visible {
    outline: 2px solid var(--primary, #3b5bff);
    outline-offset: 1px;
  }

  .kpis {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 14px;
    margin-bottom: 22px;
  }
  @media (max-width: 860px) {
    .kpis {
      grid-template-columns: repeat(2, 1fr);
    }
  }
  @media (max-width: 460px) {
    .kpis {
      grid-template-columns: 1fr;
    }
  }
  .kpi {
    position: relative;
    border: 1px solid var(--border, #e5e7eb);
    border-radius: 10px;
    padding: 16px;
    background: var(--card, #fff);
  }
  .kpi::before {
    content: '';
    position: absolute;
    left: 0;
    top: 12px;
    bottom: 12px;
    width: 3px;
    border-radius: 3px;
    background: var(--primary, #3b5bff);
  }
  .kpi.s-crit::before {
    background: var(--tracking-crit);
  }
  .kpi.s-warn::before {
    background: var(--tracking-warn);
  }
  .kpi.s-ok::before {
    background: var(--tracking-ok);
  }
  .kpi .k-label {
    font-size: 12px;
    color: var(--muted-foreground, #6b7280);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 6px;
  }
  .kpi .k-val {
    font-size: 30px;
    font-weight: 700;
    letter-spacing: -0.02em;
    line-height: 1;
  }
  .kpi.s-crit .k-val {
    color: var(--tracking-crit);
  }
  .kpi .k-val small {
    font-size: 15px;
    color: var(--muted-foreground, #6b7280);
    font-weight: 500;
  }
  .kpi .k-sub {
    font-size: 12px;
    color: var(--muted-foreground, #6b7280);
    margin-top: 8px;
  }

  .num {
    font-variant-numeric: tabular-nums;
  }
  .muted {
    color: var(--muted-foreground, #6b7280);
  }

  .tbl-wrap {
    overflow-x: auto;
    border: 1px solid var(--border, #e5e7eb);
    border-radius: 10px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 14px;
    min-width: 640px;
  }
  thead th {
    text-align: left;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--muted-foreground, #6b7280);
    font-weight: 600;
    padding: 11px 16px;
    border-bottom: 1px solid var(--border, #e5e7eb);
    background: var(--muted, #f9fafb);
  }
  tbody td {
    padding: 12px 16px;
    border-bottom: 1px solid var(--border, #e5e7eb);
    vertical-align: middle;
  }
  tbody tr:last-child td {
    border-bottom: none;
  }
  tbody tr.clickable {
    cursor: pointer;
  }
  tbody tr.clickable:hover {
    background: var(--muted, #f9fafb);
  }
  .ct {
    font-weight: 500;
  }
  .learner {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .learner .who .nm {
    font-weight: 600;
  }
  .learner .who .em {
    font-size: 12px;
    color: var(--muted-foreground, #6b7280);
  }
  .mini {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .bar {
    width: 70px;
    height: 8px;
    border-radius: 999px;
    background: var(--muted, #eceff3);
    overflow: hidden;
  }
  .bar > span {
    display: block;
    height: 100%;
    border-radius: 999px;
  }
  .mini .pct {
    font-size: 13px;
    color: var(--foreground, #374151);
    min-width: 34px;
  }
  .pill {
    font-size: 12px;
    font-weight: 600;
    padding: 3px 9px;
    border-radius: 999px;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    white-space: nowrap;
  }
  .pill::before {
    content: '';
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: currentColor;
  }
  .pill-ok {
    background: color-mix(in srgb, var(--tracking-ok) 15%, transparent);
    color: var(--tracking-ok);
  }
  .pill-warn {
    background: color-mix(in srgb, var(--tracking-warn) 18%, transparent);
    color: var(--tracking-warn);
  }
  .pill-crit {
    background: color-mix(in srgb, var(--tracking-crit) 15%, transparent);
    color: var(--tracking-crit);
  }
  .empty {
    padding: 40px 0;
    text-align: center;
    color: var(--muted-foreground, #6b7280);
    font-size: 14px;
  }
</style>
