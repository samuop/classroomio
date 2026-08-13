<script lang="ts">
  import * as Alert from '@cio/ui/base/alert';
  import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
  import { resolve } from '$app/paths';
  import { courseApi } from '$features/course/api';
  import { getNavItemRoute } from '$features/course/utils/functions';
  import { t } from '$lib/utils/functions/translations';

  /**
   * An unpublished course is invisible in the student's LMS list even to
   * students who are already enrolled — getEnrolledCourses filters on
   * `is_published = true`. Every step before that reports success: the student
   * gets an email, the group_member row exists, the People table lists them.
   * The only place the truth was visible was the small badge in the header, so
   * this says it where people are actually adding students.
   */
  interface Props {
    class?: string;
  }

  let { class: className = '' }: Props = $props();

  const courseId = $derived(courseApi.course?.id ?? '');
  const isUnpublished = $derived(!!courseId && courseApi.course?.isPublished === false);
</script>

{#if isUnpublished}
  <Alert.Root variant="warning" class={className}>
    <TriangleAlertIcon />
    <Alert.Title>{$t('course.unpublished_notice.title')}</Alert.Title>
    <Alert.Description>
      <p>{$t('course.unpublished_notice.description')}</p>
      <a class="font-medium underline underline-offset-2" href={resolve(getNavItemRoute(courseId, 'settings'), {})}>
        {$t('course.unpublished_notice.action')}
      </a>
    </Alert.Description>
  </Alert.Root>
{/if}
