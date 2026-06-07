<script lang="ts">
  import cloneDeep from 'lodash/cloneDeep';
  import { profile } from '$lib/utils/store/user';
  import { currentOrg } from '$lib/utils/store/org';
  import { snackbar } from '$features/ui/snackbar/store';
  import { lmsExercisesApi, type LMSExercise } from '$features/lms/api/exercises.svelte';
  import { calDateDiff } from '$lib/utils/functions/date';
  import { t } from '$lib/utils/functions/translations';
  import { Badge } from '@cio/ui/base/badge';
  import { Skeleton } from '@cio/ui/base/skeleton';
  import * as Empty from '@cio/ui/base/empty';
  import BookOpenIcon from '@lucide/svelte/icons/book-open';
  import ClipboardListIcon from '@lucide/svelte/icons/clipboard-list';
  import InboxIcon from '@lucide/svelte/icons/inbox';
  import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';

  // Visual treatment per column. `dot` colours the status indicator + count
  // badge; `accent` is the thin top bar that makes each column scannable.
  const defaultSections: Section[] = [
    {
      id: 0,
      title: $t('exercises.not_submitted'),
      items: [],
      dot: 'bg-rose-500',
      badge: 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300',
      accent: 'bg-rose-500'
    },
    {
      id: 1,
      title: $t('exercises.submitted'),
      items: [],
      dot: 'bg-orange-500',
      badge: 'bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300',
      accent: 'bg-orange-500'
    },
    {
      id: 2,
      title: $t('exercises.in_progress'),
      items: [],
      dot: 'bg-amber-400',
      badge: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
      accent: 'bg-amber-400'
    },
    {
      id: 3,
      title: $t('exercises.graded'),
      items: [],
      dot: 'bg-emerald-500',
      badge: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
      accent: 'bg-emerald-500'
    }
  ];

  let sections: Section[] = $state(cloneDeep(defaultSections));
  let hasFetched = $state(false);
  let loading = $state(true);

  interface Section {
    id: number;
    title: string;
    dot: string;
    badge: string;
    accent: string;
    items: ExerciseItem[];
  }

  interface ExerciseItem {
    courseTitle: string;
    courseURL: string;
    exerciseId: string;
    exerciseTitle: string;
    exerciseURL: string;
    grade: string;
    lessonNo: string;
    lessonTitle: string;
    lessonURL: string | null;
    submissionStatus: number;
    submissionUpdatedAt: string;
  }

  const totalItems = $derived(sections.reduce((acc, s) => acc + s.items.length, 0));
  const isEmpty = $derived(!loading && totalItems === 0);

  function generateSections(exercises: LMSExercise[]): Section[] {
    const _sections: Section[] = cloneDeep(defaultSections);

    for (const exercise of exercises) {
      const { id, title, updated_at, submission, lesson, questions } = exercise;

      const submissionItem = submission[0] || {
        status_id: 0,
        updated_at,
        total: 0
      };

      const courseURL = `/courses/${lesson.course.id}`;
      const lessonURL = lesson.id ? `${courseURL}/lessons/${lesson.id}` : null;
      const exerciseURL = `${courseURL}/exercises/${id}`;

      const grade = `${submissionItem.total}/${questions.reduce((acc, cur) => (acc += cur.points), 0)}`;

      const item: ExerciseItem = {
        exerciseId: id,
        courseTitle: lesson.course.title,
        courseURL,
        exerciseTitle: title,
        exerciseURL,
        lessonTitle: lesson.title,
        lessonNo: lesson.order < 9 ? '0' + (lesson.order + 1) : `${lesson.order}`,
        lessonURL,
        submissionStatus: submissionItem.status_id,
        submissionUpdatedAt: calDateDiff(submissionItem.updated_at),
        grade
      };

      _sections[submissionItem.status_id].items.push(item);
    }

    return _sections;
  }

  async function fetchData(profileId?: string, orgId?: string) {
    if (hasFetched || !profileId || !orgId) {
      return;
    }

    hasFetched = true;
    loading = true;

    await lmsExercisesApi.fetchLMSExercises(orgId);

    if (!lmsExercisesApi.success) {
      snackbar.error('snackbar.exercise.error_fetching');
      loading = false;
      return;
    }

    if (lmsExercisesApi.exercises && lmsExercisesApi.exercises.length > 0) {
      sections = generateSections(lmsExercisesApi.exercises);
    }

    loading = false;
  }

  $effect(() => {
    fetchData($profile.id, $currentOrg.id);
  });
</script>

{#if isEmpty}
  <Empty.Root class="ui:py-20">
    <Empty.Header>
      <Empty.Media variant="icon">
        <ClipboardListIcon class="size-6" />
      </Empty.Media>
      <Empty.Title>{$t('exercises.empty_all_title')}</Empty.Title>
      <Empty.Description>{$t('exercises.empty_all_description')}</Empty.Description>
    </Empty.Header>
  </Empty.Root>
{:else}
  <div class="flex w-full gap-4 overflow-x-auto pb-4">
    {#each sections as section (section.id)}
      <div
        class="flex h-[72vh] w-[320px] min-w-[320px] flex-col overflow-hidden rounded-xl border border-gray-200 bg-gray-50/60 dark:border-neutral-800 dark:bg-neutral-900/40"
      >
        <!-- accent bar -->
        <div class="h-1 w-full {section.accent}"></div>

        <!-- column header -->
        <div
          class="flex items-center justify-between gap-2 border-b border-gray-200 bg-white/60 px-4 py-3 dark:border-neutral-800 dark:bg-neutral-900/60"
        >
          <div class="flex items-center gap-2">
            <span class="size-2 rounded-full {section.dot}"></span>
            <p class="text-sm font-semibold text-gray-800 dark:text-neutral-100">{section.title}</p>
          </div>
          <span
            class="inline-flex min-w-6 items-center justify-center rounded-full px-2 py-0.5 text-xs font-semibold {section.badge}"
          >
            {section.items.length}
          </span>
        </div>

        <!-- column body -->
        <div class="flex-1 space-y-2.5 overflow-y-auto px-3 py-3">
          {#if loading}
            {#each [0, 1, 2] as i (i)}
              <div class="rounded-lg border border-gray-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-800">
                <Skeleton class="mb-2 h-3 w-24" />
                <Skeleton class="mb-2 h-4 w-full" />
                <Skeleton class="h-3 w-32" />
              </div>
            {/each}
          {:else if section.items.length === 0}
            <div class="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
              <InboxIcon class="size-7 text-gray-300 dark:text-neutral-600" />
              <p class="text-xs text-gray-400 dark:text-neutral-500">{$t('exercises.empty_column')}</p>
            </div>
          {:else}
            {#each section.items as item (item.exerciseId)}
              <a
                href={item.exerciseURL}
                class="group block rounded-lg border border-gray-200 bg-white p-3 transition-all hover:border-primary/40 hover:shadow-sm dark:border-neutral-800 dark:bg-neutral-800 dark:hover:border-primary/50"
              >
                <!-- course chip -->
                <Badge variant="secondary" class="mb-2 max-w-full truncate text-[11px] font-normal">
                  {item.courseTitle}
                </Badge>

                <!-- exercise title -->
                <div class="flex items-start justify-between gap-2">
                  <p
                    class="text-sm leading-snug font-medium text-gray-900 group-hover:text-primary dark:text-neutral-50"
                  >
                    {#if section.id === 3}
                      <span
                        class="mr-1 inline-flex items-center rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                      >
                        {item.grade}
                      </span>
                    {/if}
                    {item.exerciseTitle}
                  </p>
                  <ArrowRightIcon
                    class="mt-0.5 size-4 shrink-0 text-gray-300 transition-all group-hover:translate-x-0.5 group-hover:text-primary dark:text-neutral-600"
                  />
                </div>

                <!-- lesson meta -->
                {#if item.lessonURL}
                  <div class="mt-2 flex items-center gap-1.5 text-xs text-gray-500 dark:text-neutral-400">
                    <BookOpenIcon class="size-3.5 shrink-0" />
                    <span class="truncate">{item.lessonTitle}</span>
                  </div>
                {/if}

                <!-- timestamp -->
                <p class="mt-2 text-[11px] text-gray-400 dark:text-neutral-500">
                  {item.submissionUpdatedAt}
                </p>
              </a>
            {/each}
          {/if}
        </div>
      </div>
    {/each}
  </div>
{/if}
