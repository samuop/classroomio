<script lang="ts">
  import { brandName } from '$lib/utils/branding';
  import * as Page from '@cio/ui/base/page';

  import { WorkspacesPage } from '$features/account';
  import { t } from '$lib/utils/functions/translations';
</script>

<svelte:head>
  <title>{$t('account.workspaces.page_title')} - {brandName}</title>
</svelte:head>

<Page.Header>
  <Page.HeaderContent>
    <Page.Title>{$t('account.workspaces.page_title')}</Page.Title>
    <Page.Subtitle>{$t('account.workspaces.page_description')}</Page.Subtitle>
  </Page.HeaderContent>
</Page.Header>
<Page.Body>
  {#snippet child()}
    <WorkspacesPage />
  {/snippet}
</Page.Body>
