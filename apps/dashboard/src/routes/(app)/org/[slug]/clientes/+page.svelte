<script lang="ts">
  import * as Page from '@cio/ui/base/page';
  import ClientsPage from '$features/clients/pages/clients.svelte';
  import { brandName } from '$lib/utils/branding';
  import { t } from '$lib/utils/functions/translations';
</script>

<svelte:head>
  <title>{$t('clients.page_title')} - {brandName}</title>
</svelte:head>

<Page.Header>
  <Page.HeaderContent>
    <Page.Title>{$t('clients.page_title')}</Page.Title>
    <Page.Subtitle>{$t('clients.page_description')}</Page.Subtitle>
  </Page.HeaderContent>
</Page.Header>
<Page.Body>
  {#snippet child()}
    <ClientsPage />
  {/snippet}
</Page.Body>
