<script lang="ts">
  /**
   * The ‹ › pair in the page header: pure movement through the course, in
   * content order, with the arrow keys wired to match.
   *
   * Marking a lesson complete used to live here too. It does not any more —
   * asking at the top of a page whether you have read it is asking before the
   * reading, and it crowded a header that is already tight on a phone. That
   * action now sits at the END of the lesson, merged with going on, in
   * `lesson-completion-footer.svelte`. These arrows deliberately claim nothing:
   * a student can jump back to re-read without altering their record.
   */
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
  import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
  import { Button } from '@cio/ui/base/button';
  import * as Tooltip from '@cio/ui/base/tooltip';
  import { t } from '$lib/utils/functions/translations';
  import { courseApi } from '$features/course/api';
  import { getOrderedNavigableContent, getContentRoute } from '$features/course/utils/content';
  import { ContentType } from '@cio/utils/constants/content';
  import type { CourseContentItem } from '$features/course/utils/types';

  interface Props {
    lessonId?: string;
    /** When on an exercise page, pass this instead so the arrows walk content order from there. */
    exerciseId?: string;
  }

  let { lessonId, exerciseId }: Props = $props();

  const navigableContentItems = $derived(getOrderedNavigableContent(courseApi.course));

  /** Immediate neighbours in full content order (locked content is hidden in the UI, so nothing is skipped). */
  const prevNextContent = $derived.by(() => {
    const currentId = lessonId ?? exerciseId;
    const currentType = lessonId ? ContentType.Lesson : ContentType.Exercise;
    if (!currentId) return { prev: null, next: null };
    const idx = navigableContentItems.findIndex((item) => item.type === currentType && item.id === currentId);
    if (idx < 0) return { prev: null, next: null };
    return {
      prev: navigableContentItems[idx - 1] ?? null,
      next: navigableContentItems[idx + 1] ?? null
    };
  });

  function goToContent(target: CourseContentItem | null) {
    if (!target) return;
    const courseIdResolved = courseApi.course?.id;
    if (!courseIdResolved) return;
    const path = getContentRoute(courseIdResolved, target);
    if (!path) return;
    goto(resolve(path, {}));
  }

  const isPrevDisabled = $derived(!prevNextContent.prev);
  const isNextDisabled = $derived(!prevNextContent.next);

  const INTERACTIVE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

  function handleKeydown(event: KeyboardEvent) {
    const target = event.target as HTMLElement;
    if (INTERACTIVE_TAGS.has(target.tagName) || target.isContentEditable) return;

    if (event.key === 'ArrowLeft' && !isPrevDisabled) {
      event.preventDefault();
      goToContent(prevNextContent.prev);
    } else if (event.key === 'ArrowRight' && !isNextDisabled) {
      event.preventDefault();
      goToContent(prevNextContent.next);
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<Tooltip.Provider>
  <div class="flex items-center gap-1">
    <Tooltip.Root>
      <Tooltip.Trigger>
        <Button
          size="icon-sm"
          variant="outline"
          onclick={() => goToContent(prevNextContent.prev)}
          disabled={isPrevDisabled}
          aria-label={$t('course.navItem.lessons.prev')}
        >
          <ChevronLeftIcon size={14} />
        </Button>
      </Tooltip.Trigger>
      <Tooltip.Content side="bottom" sideOffset={4}>
        {$t('course.navItem.lessons.prev_shortcut')}
      </Tooltip.Content>
    </Tooltip.Root>

    <Tooltip.Root>
      <Tooltip.Trigger>
        <Button
          size="icon-sm"
          variant="outline"
          onclick={() => goToContent(prevNextContent.next)}
          disabled={isNextDisabled}
          aria-label={$t('course.navItem.lessons.next')}
        >
          <ChevronRightIcon size={14} />
        </Button>
      </Tooltip.Trigger>
      <Tooltip.Content side="bottom" sideOffset={4}>
        {$t('course.navItem.lessons.next_shortcut')}
      </Tooltip.Content>
    </Tooltip.Root>
  </div>
</Tooltip.Provider>
