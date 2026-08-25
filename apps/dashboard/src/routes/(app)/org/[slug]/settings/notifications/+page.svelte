<script lang="ts">
  import { onMount } from 'svelte';

  import * as Page from '@cio/ui/base/page';

  import { NotificationSettingsForm, notificationSettingsApi } from '$features/notifications';
  import { brandName } from '$lib/utils/branding';
  import { t } from '$lib/utils/functions/translations';

  let initialized = $state(false);

  onMount(async () => {
    await notificationSettingsApi.fetchSettings();
    initialized = true;
  });
</script>

<svelte:head>
  <title>{$t('notifications.settings.title')} - {brandName}</title>
</svelte:head>

<Page.Root class="mx-auto flex w-[90%] px-4 md:max-w-2xl lg:max-w-3xl">
  <Page.Header isSticky class="ui:bg-background z-10">
    <Page.HeaderContent>
      <Page.Title>{$t('notifications.settings.title')}</Page.Title>
      <Page.Subtitle>{$t('notifications.settings.subtitle')}</Page.Subtitle>
    </Page.HeaderContent>
  </Page.Header>

  <Page.Body>
    {#snippet child()}
      {#if !initialized}
        <p class="ui:text-muted-foreground text-sm">{$t('notifications.settings.loading')}</p>
      {:else}
        <NotificationSettingsForm disabled={notificationSettingsApi.saving} />
      {/if}
    {/snippet}
  </Page.Body>
</Page.Root>
