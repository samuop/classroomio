<script lang="ts">
  import { page } from '$app/state';
  import { resolve } from '$app/paths';
  import BookOpenIcon from '@lucide/svelte/icons/book-open';
  import CircleCheckIcon from '@lucide/svelte/icons/circle-check';
  import LayersIcon from '@lucide/svelte/icons/layers';
  import GraduationCapIcon from '@lucide/svelte/icons/graduation-cap';
  import DownloadIcon from '@lucide/svelte/icons/download';

  import { t } from '$lib/utils/functions/translations';
  import { Badge } from '@cio/ui/base/badge';
  import { Button } from '@cio/ui/base/button';
  import { Progress } from '@cio/ui/base/progress';
  import { ActivityCard, HeroProfileCard, LoadingPage } from '$features/ui';
  import { studentApi } from '$features/student/api/student.svelte';
  import { downloadCSV } from '$lib/utils/functions/download-csv';
  import { currentOrg } from '$lib/utils/store/org';

  const profileId = $derived(page.params.profileId ?? '');

  // Wait for the current org to be hydrated before fetching: the API client
  // injects the cio-org-id header from currentOrg, and the /student endpoint
  // requires it. Fetching too early (org not loaded yet) returns 400.
  $effect(() => {
    if (profileId && $currentOrg?.id) {
      studentApi.ensureFetched(profileId);
    }
  });

  const overview = $derived(studentApi.overview);

  const summaryCards = $derived([
    {
      title: $t('student_overview.courses_enrolled'),
      description: $t('student_overview.courses_enrolled_description'),
      icon: BookOpenIcon,
      percentage: overview?.summary.totalCourses ?? 0,
      isCount: true
    },
    {
      title: $t('student_overview.courses_completed'),
      description: $t('student_overview.courses_completed_description'),
      icon: CircleCheckIcon,
      percentage: overview?.summary.coursesCompleted ?? 0,
      isCount: true
    },
    {
      title: $t('student_overview.average_progress'),
      description: $t('student_overview.average_progress_description'),
      icon: LayersIcon,
      percentage: overview?.summary.averageProgress ?? 0,
      isCount: false
    },
    {
      title: $t('student_overview.average_grade'),
      description: $t('student_overview.average_grade_description'),
      icon: GraduationCapIcon,
      percentage: overview?.summary.averageGrade ?? 0,
      isCount: false
    }
  ]);

  function exportCSV() {
    if (!overview) return;

    const rows = overview.courses.map((course) => ({
      [$t('student_overview.export.course')]: course.courseTitle,
      [$t('student_overview.export.progress')]: `${course.progressPercentage}%`,
      [$t('student_overview.export.lessons')]: `${course.lessonsCompleted}/${course.lessonsCount}`,
      [$t('student_overview.export.exercises')]: `${course.exercisesCompleted}/${course.exercisesCount}`,
      [$t('student_overview.export.grade')]: `${course.averageGrade}%`,
      [$t('student_overview.export.completed')]: course.isComplete
        ? $t('student_overview.yes')
        : $t('student_overview.no'),
      [$t('student_overview.export.certificate')]: course.certificateEarnedAt ?? '-'
    }));

    const fileName = (overview.user.fullName || overview.user.email || 'student').replace(/\s+/g, '-').toLowerCase();
    downloadCSV(rows, `${fileName}-expediente`);
  }
</script>

{#if overview}
  <section class="mx-auto w-full max-w-5xl space-y-6 px-1 py-2">
    <!-- Header: profile + export -->
    <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      {#if overview.user}
        <div class="min-w-0 flex-1">
          <HeroProfileCard user={overview.user} />
        </div>
      {/if}

      <Button variant="outline" size="sm" onclick={exportCSV} class="shrink-0 self-start">
        <DownloadIcon size={16} class="mr-1" />
        {$t('student_overview.export_csv')}
      </Button>
    </div>

    <!-- KPI cards: 4 across on wide screens so none is orphaned -->
    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {#each summaryCards as card (card.title)}
        <ActivityCard
          activity={{
            title: card.title,
            description: card.description,
            icon: card.icon,
            percentage: card.percentage,
            hidePercentage: card.isCount
          }}
        />
      {/each}
    </div>

    <!-- Courses -->
    <div class="rounded-xl border p-4 md:p-6">
      <h3 class="mb-4 text-xl font-semibold">{$t('student_overview.courses')}</h3>

      {#if overview.courses.length === 0}
        <p class="ui:text-muted-foreground text-sm">{$t('student_overview.no_courses')}</p>
      {/if}

      <div class="space-y-3">
        {#each overview.courses as course (course.courseId)}
          <div class="ui:hover:border-primary flex flex-col gap-3 rounded-lg border p-4 ui:transition-colors">
            <div class="flex items-center justify-between gap-4">
              <a
                href={resolve(`/courses/${course.courseId}/lessons`, {})}
                class="ui:hover:text-primary truncate font-semibold ui:transition-colors"
              >
                {course.courseTitle}
              </a>
              {#if course.isComplete}
                <Badge class="shrink-0 bg-green-200 text-green-700">{$t('student_overview.completed')}</Badge>
              {:else}
                <Badge type="outline" class="shrink-0">{course.progressPercentage}%</Badge>
              {/if}
            </div>
            <Progress value={course.progressPercentage} />
            <div class="ui:text-muted-foreground flex flex-wrap gap-x-5 gap-y-1 text-sm">
              <span>{$t('student_overview.lessons')}: {course.lessonsCompleted}/{course.lessonsCount}</span>
              <span>{$t('student_overview.exercises')}: {course.exercisesCompleted}/{course.exercisesCount}</span>
              <span>{$t('student_overview.average_grade')}: {course.averageGrade}%</span>
            </div>
          </div>
        {/each}
      </div>
    </div>

    <!-- Programs -->
    {#if overview.programs.length > 0}
      <div class="rounded-xl border p-4 md:p-6">
        <h3 class="mb-4 text-xl font-semibold">{$t('student_overview.programs')}</h3>
        <div class="space-y-3">
          {#each overview.programs as program (program.id)}
            <div class="ui:hover:border-primary flex items-center justify-between gap-4 rounded-lg border p-4 ui:transition-colors">
              <a
                href={resolve(`/programs/${program.id}/people`, {})}
                class="ui:hover:text-primary truncate font-semibold ui:transition-colors"
              >
                {program.name}
              </a>
              <Badge type="outline" class="shrink-0">{program.courseCount} {$t('student_overview.courses')}</Badge>
            </div>
          {/each}
        </div>
      </div>
    {/if}
  </section>
{:else}
  <LoadingPage />
{/if}
