<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { t } from '$lib/utils/functions/translations';
  import { currentOrg, currentOrgPath } from '$lib/utils/store/org';
  import { shortenName } from '$lib/utils/functions/string';
  import { Spinner } from '@cio/ui/base/spinner';
  import * as Avatar from '@cio/ui/base/avatar';
  import * as Select from '@cio/ui/base/select';
  import UsersIcon from '@lucide/svelte/icons/users';
  import BookOpenIcon from '@lucide/svelte/icons/book-open';
  import BuildingIcon from '@lucide/svelte/icons/building-2';
  import { trackingApi } from '$features/tracking/api/tracking.svelte';
  import type { TrackingAxis, TrackingStatus } from '$features/tracking/utils/types';

  let axis = $state<TrackingAxis>('student');

  /** `TODAS` or one company id. */
  const TODAS = 'all';
  let empresa = $state<string>(TODAS);

  onMount(() => {
    const orgId = $currentOrg.id;
    if (orgId) trackingApi.ensureFetched(orgId);
  });

  const overview = $derived(trackingApi.overview);
  const companies = $derived(overview?.companies ?? []);
  const hasClients = $derived(overview?.hasClients ?? false);

  /**
   * Picking one company filters what is already loaded instead of asking again.
   *
   * The server sends every row tagged with its company, so the answer is already
   * here; a round trip per click would only add a spinner. The KPIs are
   * recomputed from the visible rows for the same reason they have to be — a
   * header that keeps reporting 48 alumnos over a table showing 18 is worse than
   * no header.
   */
  const alumnosVisibles = $derived(
    empresa === TODAS ? (overview?.byStudent ?? []) : (overview?.byStudent ?? []).filter((s) => s.orgId === empresa)
  );
  const cursosVisibles = $derived(
    empresa === TODAS ? (overview?.byCourse ?? []) : (overview?.byCourse ?? []).filter((c) => c.orgId === empresa)
  );

  const resumen = $derived.by(() => {
    const alumnos = alumnosVisibles;
    const total = alumnos.length;
    const inscripciones = alumnos.reduce((suma, alumno) => suma + alumno.coursesCount, 0);

    return {
      totalStudents: total,
      atRiskCount: alumnos.filter((alumno) => alumno.status === 'at_risk').length,
      averageProgress:
        total > 0 ? Math.round(alumnos.reduce((suma, alumno) => suma + alumno.averageProgress, 0) / total) : 0,
      totalCourses: cursosVisibles.length,
      enrolmentsPerStudent: total > 0 ? Math.round((inscripciones / total) * 10) / 10 : 0
    };
  });

  /**
   * The company column only earns its width when the rows actually span several.
   * Filtered to one, it repeats the same name the selector is already showing.
   */
  const showCompany = $derived(companies.length > 1 && empresa === TODAS);

  function nombreEmpresa(id: string) {
    return companies.find((company) => company.id === id)?.name ?? '';
  }

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
  /**
   * The learner's company rides in the URL because the record lives THERE, not
   * in the consultancy you are standing in. Sent for every row rather than only
   * cross-company ones, so the page never has to guess.
   */
  function openProfile(profileId: string, orgId: string) {
    goto(`${$currentOrgPath}/students/${profileId}?org=${orgId}`);
  }
</script>

<div class="tracking">
  {#if trackingApi.loading && !overview}
    <div class="flex h-40 items-center justify-center">
      <Spinner class="text-muted-foreground size-6" />
    </div>
  {:else if overview}
    <div class="switches">
      <!-- axis switch -->
      <div class="axis-switch" role="group" aria-label={$t('tracking.title')}>
        <button type="button" aria-pressed={axis === 'student'} onclick={() => (axis = 'student')}>
          <UsersIcon class="size-4" />
          {$t('tracking.axis_student')}
        </button>
        <button type="button" aria-pressed={axis === 'course'} onclick={() => (axis = 'course')}>
          <BookOpenIcon class="size-4" />
          {$t('tracking.axis_course')}
        </button>
      </div>

      <!-- Company picker: only a consultancy has more than one to pick from. -->
      {#if hasClients}
        <div class="company-pick">
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
      {/if}
    </div>

    {#if axis === 'student'}
      <!-- ============ POR ALUMNO ============ -->
      <div class="kpis">
        <div class="kpi s-accent">
          <div class="k-label">{$t('tracking.kpi_students')}</div>
          <div class="k-val num">{resumen.totalStudents}</div>
          <div class="k-sub">{$t('tracking.kpi_students_sub', { count: resumen.totalCourses })}</div>
        </div>
        <div class="kpi s-warn">
          <div class="k-label">{$t('tracking.kpi_avg_progress')}</div>
          <div class="k-val num">{resumen.averageProgress}<small>%</small></div>
          <div class="k-sub">{$t('tracking.kpi_avg_progress_sub')}</div>
        </div>
        <div class="kpi s-crit">
          <div class="k-label">{$t('tracking.kpi_at_risk')}</div>
          <div class="k-val num">{resumen.atRiskCount}</div>
          <div class="k-sub">{$t('tracking.kpi_at_risk_sub', { total: resumen.totalStudents })}</div>
        </div>
        <div class="kpi s-ok">
          <div class="k-label">{$t('tracking.kpi_enrolments')}</div>
          <div class="k-val num">{resumen.enrolmentsPerStudent}</div>
          <div class="k-sub">{$t('tracking.kpi_enrolments_sub')}</div>
        </div>
      </div>

      {#if alumnosVisibles.length === 0}
        <p class="empty">{$t('tracking.empty_students')}</p>
      {:else}
        <div class="tbl-wrap">
          <table>
            <thead>
              <tr>
                <th>{$t('tracking.col_student')}</th>
                {#if showCompany}
                  <th>{$t('tracking.col_company')}</th>
                {/if}
                <th>{$t('tracking.col_courses')}</th>
                <th>{$t('tracking.col_progress')}</th>
                <th>{$t('tracking.col_grade')}</th>
                <th>{$t('tracking.col_activity')}</th>
                <th>{$t('tracking.col_status')}</th>
              </tr>
            </thead>
            <tbody>
              {#each alumnosVisibles as s (s.key)}
                <tr
                  class="clickable"
                  onclick={() => openProfile(s.profileId, s.orgId)}
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
                  {#if showCompany}
                    <td><span class="company">{s.orgName}</span></td>
                  {/if}
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
          <div class="k-val num">{resumen.totalCourses}</div>
          <div class="k-sub">{$t('tracking.kpi_courses_sub')}</div>
        </div>
        <div class="kpi s-warn">
          <div class="k-label">{$t('tracking.kpi_avg_progress_course')}</div>
          <div class="k-val num">{resumen.averageProgress}<small>%</small></div>
          <div class="k-sub">{$t('tracking.kpi_avg_progress_course_sub')}</div>
        </div>
        <div class="kpi s-crit">
          <div class="k-label">{$t('tracking.kpi_at_risk')}</div>
          <div class="k-val num">{resumen.atRiskCount}</div>
          <div class="k-sub">{$t('tracking.kpi_at_risk_sub', { total: resumen.totalStudents })}</div>
        </div>
        <div class="kpi s-ok">
          <div class="k-label">{$t('tracking.kpi_students')}</div>
          <div class="k-val num">{resumen.totalStudents}</div>
          <div class="k-sub">{$t('tracking.kpi_enrolments_sub')}</div>
        </div>
      </div>

      {#if cursosVisibles.length === 0}
        <p class="empty">{$t('tracking.empty_courses')}</p>
      {:else}
        <div class="tbl-wrap">
          <table>
            <thead>
              <tr>
                <th>{$t('tracking.col_course')}</th>
                {#if showCompany}
                  <th>{$t('tracking.col_company')}</th>
                {/if}
                <th>{$t('tracking.col_enrolled')}</th>
                <th>{$t('tracking.col_avg_progress')}</th>
                <th>{$t('tracking.col_grade')}</th>
                <th>{$t('tracking.col_completed')}</th>
              </tr>
            </thead>
            <tbody>
              {#each cursosVisibles as c (c.courseId)}
                <tr>
                  <td class="ct">{c.courseTitle}</td>
                  {#if showCompany}
                    <td><span class="company">{c.orgName}</span></td>
                  {/if}
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

  .company-pick {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .switches {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 20px;
  }

  .axis-switch {
    display: inline-flex;
    gap: 2px;
    padding: 3px;
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
    display: inline-flex;
    align-items: center;
    gap: 7px;
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
  .company {
    display: inline-block;
    max-width: 180px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 13px;
    padding: 2px 8px;
    border-radius: 6px;
    border: 1px solid var(--border, #e5e7eb);
    color: var(--muted-foreground, #6b7280);
    vertical-align: middle;
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
