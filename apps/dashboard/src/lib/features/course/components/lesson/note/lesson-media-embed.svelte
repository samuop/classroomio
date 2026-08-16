<script lang="ts">
  /**
   * Renders one lesson-media marker in the reading view.
   *
   * The note stores only an inert marker — a player written into the HTML is
   * stripped by the sanitizer on purpose — so the real component is mounted here
   * instead, from lesson state the note itself never carries.
   */
  import { lessonApi } from '$features/course/api';
  import { findLessonDocument, findLessonVideo, SLIDE_MEDIA_ID } from '$features/course/utils/lesson-media';
  import { t } from '$lib/utils/functions/translations';
  import type { LessonMediaKind } from '@cio/ui/tools/sanitize';
  import { DocumentCard } from '@cio/ui';
  import FileTextIcon from '@lucide/svelte/icons/file-text';
  import LessonVideoPlayer from '$features/course/components/lesson/video/lesson-video-player.svelte';

  interface Props {
    kind: LessonMediaKind;
    mediaId: string;
  }

  let { kind, mediaId }: Props = $props();

  const lesson = $derived(lessonApi.lesson);
  const video = $derived(kind === 'video' ? findLessonVideo(lesson, mediaId) : undefined);
  const document = $derived(kind === 'document' ? findLessonDocument(lesson, mediaId) : undefined);
  const slideUrl = $derived(kind === 'slide' && mediaId === SLIDE_MEDIA_ID ? lesson?.slideUrl : null);

  const slideEmbedUrl = $derived.by(() => {
    if (!slideUrl) return null;
    // Canva only renders embedded with ?embed; mirrors slide.svelte.
    if (slideUrl.includes('www.canva.com') && !slideUrl.includes('?embed')) return `${slideUrl}?embed`;
    return slideUrl;
  });

  const isMissing = $derived(!video && !document && !slideEmbedUrl);

  const documentSubtitle = $derived(document ? document.type.toUpperCase() : '');
</script>

{#if video}
  <div class="my-5 w-full overflow-hidden">
    {#key video.type === 'upload' ? (video.assetId ?? video.link) : video.link}
      <LessonVideoPlayer {video} />
    {/key}
  </div>
{:else if slideEmbedUrl}
  <!-- Sizing lives in `iframe.iframe` (app.css): 16:9 at every width. -->
  <iframe title="Embeded Slides" src={slideEmbedUrl} frameborder="0" class="iframe my-5" allowfullscreen={true}
  ></iframe>
{:else if document}
  <div class="my-5">
    <DocumentCard title={document.name} subtitle={documentSubtitle}>
      {#snippet actions()}
        <!--
          `resolve()` rewrites app routes for the base path. document.link is an
          absolute storage URL, so resolving it would be wrong — same reason
          document-card.svelte links to it directly.
        -->
        <!-- eslint-disable svelte/no-navigation-without-resolve -->
        <a
          href={document.link}
          target="_blank"
          rel="noopener noreferrer"
          class="ui:border-input ui:bg-background ui:text-foreground hover:ui:bg-accent hover:ui:text-accent-foreground inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium"
        >
          <FileTextIcon size={14} />
          {$t('course.navItem.lessons.materials.tabs.document.view_document')}
        </a>
        <!-- eslint-enable svelte/no-navigation-without-resolve -->
      {/snippet}
    </DocumentCard>
  </div>
{:else if isMissing}
  <!--
    The media this marker points at is gone. Saying so beats a blank gap: a hole
    in the page reads as a rendering bug and sends the teacher looking in the
    wrong place.
  -->
  <p
    class="border-destructive text-destructive my-5 flex items-center gap-2 rounded-md border border-dashed px-3 py-2 text-sm"
  >
    <FileTextIcon size={14} />
    {$t('course.navItem.lessons.materials.media_not_found')}
  </p>
{/if}
