<script lang="ts">
  import * as Page from '@cio/ui/base/page';
  import { t } from '$lib/utils/functions/translations';
  import SourcesPage from '$features/ai-assistant/sources/sources-page.svelte';

  let { data } = $props();
</script>

<!--
  `w-full`, not `calc(95vw - var(--sidebar-width))`. That expression measures the
  VIEWPORT and subtracts only the left sidebar, so it ignores the AI assistant
  panel — which is a flex sibling that shrinks this page's container when open.
  The row overflowed to the right and its "Add source" button, pushed there by
  justify-between, ended up behind the panel: the only way to add a source was
  invisible whenever the assistant was open. The container already knows its own
  width; filling it is enough.
-->
<Page.Root class="mx-auto flex w-full px-6 py-4">
  <Page.Header>
    <Page.HeaderContent>
      <Page.Title>
        {$t('course.sources.heading')}
      </Page.Title>
      <Page.Description>
        {$t('course.sources.description')}
      </Page.Description>
    </Page.HeaderContent>
  </Page.Header>

  <Page.Body>
    {#snippet child()}
      <SourcesPage courseId={data.courseId} />
    {/snippet}
  </Page.Body>
</Page.Root>