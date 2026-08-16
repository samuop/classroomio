<script lang="ts">
  import { LessonPage } from '$features/course/pages';
  import { lessonApi } from '$features/course/api';
  import { profile } from '$lib/utils/store/user';
  import type { Lesson } from '$features/course/utils/types';
  import * as Page from '@cio/ui/base/page';

  interface Props {
    data: {
      courseId: string;
      lessonId: string;
      lesson: Lesson | null;
    };
  }

  let { data }: Props = $props();

  $effect(() => {
    if (!data.lesson) return;
    const lesson = data.lesson;
    if (lessonApi.lesson?.id === lesson.id) return;

    // Set lesson data
    lessonApi.lesson = lesson;

    // Set translations if lesson has lessonLanguages
    if (lesson.lessonLanguages) {
      lessonApi.setTranslations();
    }

    // Set current locale from profile if available
    if ($profile.locale) {
      lessonApi.currentLocale = $profile.locale;
    }
  });
</script>

<!--
  Full bleed on a phone: `w-[90%]` plus `px-4` spent a quarter of a narrow screen
  on margins, and the lesson body is the one page here that is mostly prose. The
  90% column returns from `sm` up, matching the exercise page.
-->
<Page.Root class="mx-auto flex w-full px-3 sm:w-[90%] sm:px-4 md:max-w-4xl lg:max-w-5xl">
  {#key data.lessonId}
    <LessonPage courseId={data.courseId} lessonId={data.lessonId} />
  {/key}
</Page.Root>
