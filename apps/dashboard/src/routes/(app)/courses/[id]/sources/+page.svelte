<script lang="ts">
  import * as Page from '@cio/ui/base/page';
  import { t } from '$lib/utils/functions/translations';
  import SourcesPage from '$features/ai-assistant/sources/sources-page.svelte';

  let { data } = $props();
</script>

<Page.Root class="mx-auto flex w-[calc(95vw-var(--sidebar-width))]! px-6 py-4">
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