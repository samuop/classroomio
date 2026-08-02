<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { Empty } from '@cio/ui/custom/empty';
  import BookOpenIcon from '@lucide/svelte/icons/book-open';
  import LockOpenIcon from '@lucide/svelte/icons/lock-open';
  import LockIcon from '@lucide/svelte/icons/lock';
  import RotateCwIcon from '@lucide/svelte/icons/rotate-cw';
  import { Button } from '@cio/ui/base/button';
  import ContentList from '$features/course/components/lesson/content-list.svelte';
  import ContentSectionList from '$features/course/components/lesson/content-section-list.svelte';
  import CourseContentIcon from '$features/course/components/course-content-icon.svelte';
  import { courseApi } from '$features/course/api';
  import { contentApi } from '$features/course/api/content.svelte';
  import { profile } from '$lib/utils/store/user';
  import { isOrgStudent } from '$lib/utils/store/app';
  import { snackbar } from '$features/ui/snackbar/store';
  import { t } from '$lib/utils/functions/translations';
  import { getCourseContent } from '$features/course/utils/content';
  import { ContentType } from '@cio/utils/constants/content';
  import { getLastSentText, requestRetry } from '$features/ai-assistant/utils/store';

  interface Props {
    courseId: string;
    reorder?: boolean;
  }

  let { courseId, reorder = $bindable(false) }: Props = $props();

  const query = new URLSearchParams(page.url.search);

  const contentData = $derived(getCourseContent(courseApi.course));
  const contentLength = $derived(contentData.grouped ? contentData.sections.length : contentData.items.length);
  const contentItems = $derived(
    contentData.grouped ? contentData.sections.flatMap((section) => section.items) : contentData.items
  );
  const navigableContentItems = $derived(
    contentItems.filter((item) => item.type === ContentType.Lesson || item.type === ContentType.Exercise)
  );

  const sectionsTotal = $derived(
    contentData.grouped ? contentData.sections.filter((section) => section.id !== 'ungrouped').length : 0
  );
  const lessonsTotal = $derived(contentItems.filter((item) => item.type === ContentType.Lesson).length);
  const exercisesTotal = $derived(contentItems.filter((item) => item.type === ContentType.Exercise).length);

  // "Unlock all" control (team only). Show it whenever there is content and the viewer
  // isn't a student. If everything is already unlocked, the button locks all instead.
  const hasLockedContent = $derived(navigableContentItems.some((item) => item.isUnlocked === false));
  const showLockAllButton = $derived($isOrgStudent !== true && navigableContentItems.length > 0);
  let isTogglingLockAll = $state(false);

  async function handleToggleLockAll() {
    const unlock = hasLockedContent; // if anything is locked → unlock all; else lock all
    isTogglingLockAll = true;
    const ok = await contentApi.setLockAll(courseId, unlock);
    if (ok) {
      const profileId = $profile.id;
      if (profileId) {
        await courseApi.refreshCourse(courseId, profileId);
      }
      snackbar.success(unlock ? 'course.navItem.lessons.unlock_all_done' : 'course.navItem.lessons.lock_all_done');
    }
    isTogglingLockAll = false;
  }

  let isFetching: boolean = $state(false);
  let hasHandledNext = $state(false);

  const isCourseLoadedForThisPage = $derived(courseApi.course?.id === courseId);
  const canResolveNext = $derived(isCourseLoadedForThisPage && navigableContentItems.length > 0 && !hasHandledNext);

  function findFirstIncompleteContent() {
    return navigableContentItems.find((item) => !item.isComplete && item.isUnlocked === true);
  }

  $effect(() => {
    if (!canResolveNext || isFetching || query.get('next') !== 'true') return;

    hasHandledNext = true;
    const incompleteContent = findFirstIncompleteContent();
    if (incompleteContent) {
      if (incompleteContent.type === ContentType.Lesson) {
        goto(`/courses/${courseId}/lessons/${incompleteContent.id}`);
      } else {
        goto(`/courses/${courseId}/exercises/${incompleteContent.id}`);
      }
    } else {
      goto(`/courses/${courseId}/lessons`);
    }
  });

  const shouldShowNextPlaceholder = $derived(query.get('next') === 'true');
</script>

{#if shouldShowNextPlaceholder}
  <Empty
    title={$t('course.navItem.lessons.no_lesson')}
    description={$t('course.navItem.lessons.share_your_knowledge')}
    icon={BookOpenIcon}
    variant="page"
  />
{:else if contentLength > 0}
  {#if showLockAllButton}
    <div class="mb-3 flex justify-end">
      <Button
        variant="outline"
        size="sm"
        loading={isTogglingLockAll}
        disabled={isTogglingLockAll}
        onclick={handleToggleLockAll}
      >
        {#if hasLockedContent}
          <LockOpenIcon size={14} class="mr-1" />
          {$t('course.navItem.lessons.unlock_all')}
        {:else}
          <LockIcon size={14} class="mr-1" />
          {$t('course.navItem.lessons.lock_all')}
        {/if}
      </Button>
    </div>
  {/if}

  <div
    class="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3"
    role="region"
    aria-label={t.get('course.navItem.lessons.heading_v2')}
  >
    <div class="ui:border-border flex flex-col gap-1 rounded-lg border px-4 py-3">
      <div class="ui:text-muted-foreground flex items-center gap-2 text-xs font-medium">
        <CourseContentIcon type={ContentType.Section} size={14} />
        <span>{$t('course.navItem.lessons.stats.sections')}</span>
      </div>
      <p class="text-2xl font-semibold tabular-nums">{sectionsTotal}</p>
    </div>
    <div class="ui:border-border flex flex-col gap-1 rounded-lg border px-4 py-3">
      <div class="ui:text-muted-foreground flex items-center gap-2 text-xs font-medium">
        <CourseContentIcon type={ContentType.Lesson} size={14} />
        <span>{$t('course.navItem.lessons.stats.lessons')}</span>
      </div>
      <p class="text-2xl font-semibold tabular-nums">{lessonsTotal}</p>
    </div>
    <div class="ui:border-border flex flex-col gap-1 rounded-lg border px-4 py-3">
      <div class="ui:text-muted-foreground flex items-center gap-2 text-xs font-medium">
        <CourseContentIcon type={ContentType.Exercise} size={14} />
        <span>{$t('course.navItem.lessons.stats.exercises')}</span>
      </div>
      <p class="text-2xl font-semibold tabular-nums">{exercisesTotal}</p>
    </div>
  </div>

  {#if reorder}
    <p class="text-center text-xs text-gray-400 italic dark:text-white">
      {$t('course.navItem.lessons.drag')}
    </p>
  {/if}

  {#if contentData.grouped}
    <ContentSectionList {reorder} />
  {:else}
    <ContentList {reorder} />
  {/if}
{:else}
  <Empty
    title={$t('course.navItem.lessons.body_header')}
    description={$t('course.navItem.lessons.body_content')}
    icon={BookOpenIcon}
    variant="page"
  />
  {#if getLastSentText()}
    <div class="mt-4 flex justify-center">
      <Button
        variant="default"
        size="sm"
        onclick={requestRetry}
        title={$t('course.navItem.lessons.regenerate_tooltip')}
      >
        <RotateCwIcon size={14} class="mr-1.5" />
        {$t('course.navItem.lessons.regenerate')}
      </Button>
    </div>
  {/if}
{/if}
