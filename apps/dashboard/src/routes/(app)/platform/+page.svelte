<script lang="ts">
  import * as Page from '@cio/ui/base/page';
  import { Empty } from '@cio/ui/custom/empty';
  import { Button } from '@cio/ui/base/button';
  import ShieldIcon from '@lucide/svelte/icons/shield-alert';
  import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';

  import { goto } from '$app/navigation';
  import { PlatformOrganizationsPage } from '$features/platform';
  import { user } from '$lib/utils/store/user';
  import { brandName } from '$lib/utils/branding';
  import { basePath } from '$lib/utils/store/app';
  import { PLATFORM_ROLE } from '@cio/utils/constants';
  import { t } from '$lib/utils/functions/translations';

  const isPlatformAdmin = $derived($user.currentSession?.role === PLATFORM_ROLE.ADMIN);

  function goBack() {
    goto($basePath || '/');
  }
</script>

<svelte:head>
  <title>{$t('platform.orgs.page_title')} - {brandName}</title>
</svelte:head>

<Page.Header>
  <Page.HeaderContent>
    <Button variant="ghost" size="sm" class="ui:-ml-2 ui:mb-1 ui:w-fit" onclick={goBack}>
      <ArrowLeftIcon class="ui:mr-1 size-4" />
      {$t('platform.orgs.back')}
    </Button>
    <Page.Title>{$t('platform.orgs.page_title')}</Page.Title>
    <Page.Subtitle>{$t('platform.orgs.page_description')}</Page.Subtitle>
  </Page.HeaderContent>
</Page.Header>
<Page.Body>
  {#snippet child()}
    {#if isPlatformAdmin}
      <PlatformOrganizationsPage />
    {:else}
      <Empty icon={ShieldIcon} title={$t('platform.access_denied_title')} description={$t('platform.access_denied_body')} />
    {/if}
  {/snippet}
</Page.Body>
