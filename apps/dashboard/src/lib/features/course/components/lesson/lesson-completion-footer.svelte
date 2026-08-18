<script lang="ts">
  /**
   * What a student sees when they reach the end of a lesson.
   *
   * "Mark as complete" used to sit in the page header, above the content — the
   * platform asking whether you had read something you had not started. And the
   * end of the lesson offered nothing at all: you finished reading and had to
   * scroll back up to find out how to go on.
   *
   * So the action moved here and merged with the navigation. One press means
   * "read it, take me on", which is the thing a student actually wants to say.
   * The ‹ › arrows stay in the header for hopping around without claiming to
   * have read anything — advancing on its own is deliberately NOT taken as
   * completion, because on a compliance course that record is what a
   * recertification rests on, and skimming forward is not studying.
   */
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';
  import { CircleCheckIcon } from '$features/ui/icons';
  import { Button } from '@cio/ui/base/button';
  import { t } from '$lib/utils/functions/translations';
  import { courseApi, lessonApi } from '$features/course/api';
  import { getOrderedNavigableContent, getContentRoute } from '$features/course/utils/content';
  import { ContentType } from '@cio/utils/constants/content';
  import { snackbar } from '$features/ui/snackbar/store';
  import { openCourseCompletionModal } from '$features/course/store/course-completion-modal';
  import type { CourseContentItem } from '$features/course/utils/types';

  interface Props {
    lessonId: string;
    courseId: string;
  }

  let { lessonId, courseId }: Props = $props();

  let isSaving = $state(false);

  const navigableContentItems = $derived(getOrderedNavigableContent(courseApi.course));
  const lessonItems = $derived(navigableContentItems.filter((item) => item.type === ContentType.Lesson));

  /**
   * The counter speaks in lessons because that is what the student is reading,
   * while "next" follows the full content order — so the next stop can be an
   * exercise. Two different questions: where am I, and what comes after this.
   */
  const lessonPosition = $derived(lessonItems.findIndex((item) => item.id === lessonId) + 1);

  const nextItem = $derived.by<CourseContentItem | null>(() => {
    const index = navigableContentItems.findIndex(
      (item) => item.type === ContentType.Lesson && item.id === lessonId
    );
    if (index < 0) return null;
    return navigableContentItems[index + 1] ?? null;
  });

  const currentLessonItem = $derived(lessonItems.find((item) => item.id === lessonId) ?? null);
  const isComplete = $derived(currentLessonItem?.isComplete ?? false);

  function goToNext() {
    if (!nextItem) return;
    const path = getContentRoute(courseId, nextItem);
    if (!path) return;
    goto(resolve(path, {}));
  }

  /** Mirrors the new state into the course tree so the sidebar and the progress bar move now, not on the next fetch. */
  function applyCompletion(completedLessonId: string, completed: boolean) {
    const course = courseApi.course;
    if (!course?.content) return;

    const mark = (item: CourseContentItem) =>
      item.type === ContentType.Lesson && item.id === completedLessonId ? { ...item, isComplete: completed } : item;

    if (course.content.grouped) {
      courseApi.course = {
        ...course,
        content: {
          ...course.content,
          sections: course.content.sections.map((section) => ({ ...section, items: section.items.map(mark) }))
        }
      };
      return;
    }

    courseApi.course = {
      ...course,
      content: { ...course.content, items: course.content.items.map(mark) }
    };
  }

  async function completeAndContinue() {
    isSaving = true;
    await lessonApi.updateCompletion(courseId, lessonId, true);

    if (!lessonApi.success) {
      snackbar.error('snackbar.lessons.error.try_later');
      isSaving = false;
      return;
    }

    snackbar.success('snackbar.lessons.success.complete_marked');
    applyCompletion(lessonId, true);
    isSaving = false;

    // Finishing the course outranks moving on: the celebration would otherwise
    // open behind a navigation the student never asked for.
    const finishedCourse = navigableContentItems.length > 0 && navigableContentItems.every((item) => item.isComplete);
    if (finishedCourse) {
      openCourseCompletionModal(courseId);
      return;
    }

    goToNext();
  }
</script>

<div class="ui:border-border mt-10 border-t pt-6">
  <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
    <p class="ui:text-muted-foreground text-sm">
      {#if lessonPosition > 0}
        {$t('course.navItem.lessons.footer.position', { current: lessonPosition, total: lessonItems.length })}
      {/if}
    </p>

    {#if isComplete}
      <div class="flex flex-col gap-3 sm:flex-row sm:items-center">
        <span class="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
          <CircleCheckIcon size={16} filled />
          {$t('course.navItem.lessons.footer.completed')}
        </span>
        {#if nextItem}
          <Button variant="outline" onclick={goToNext}>
            {$t('course.navItem.lessons.footer.go_next')}
            <ArrowRightIcon size={16} />
          </Button>
        {/if}
      </div>
    {:else}
      <Button size="lg" onclick={completeAndContinue} loading={isSaving} disabled={isSaving}>
        <CircleCheckIcon size={16} />
        {nextItem
          ? $t('course.navItem.lessons.footer.complete_and_continue')
          : $t('course.navItem.lessons.footer.complete_and_finish')}
        {#if nextItem}
          <ArrowRightIcon size={16} />
        {/if}
      </Button>
    {/if}
  </div>
</div>
