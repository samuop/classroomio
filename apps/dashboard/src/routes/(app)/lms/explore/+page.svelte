<script lang="ts">
  import { brandName } from '$lib/utils/branding';
  import { ExplorePage } from '$features/lms/pages';
  import { t } from '$lib/utils/functions/translations';
  import * as Page from '@cio/ui/base/page';
</script>

<svelte:head>
  <title>Explore - {brandName}</title>
</svelte:head>

<Page.Root class="w-full">
  <Page.Header>
    <Page.HeaderContent>
      <Page.Title>{$t('explore.heading')}</Page.Title>
    </Page.HeaderContent>
  </Page.Header>
  <Page.Body>
    {#snippet child()}
      <ExplorePage />
    {/snippet}
  </Page.Body>
</Page.Root>
