<script lang="ts">
  import { onMount } from 'svelte';
  import { writable } from 'svelte/store';
  import { brandName } from '$lib/utils/branding';

  import * as Page from '@cio/ui/base/page';
  import { Button } from '@cio/ui/base/button';

  import { t } from '$lib/utils/functions/translations';
  import { atRiskSettingsApi, AtRiskSettingsForm } from '$features/at-risk';
  import type { AtRiskSettings } from '$features/at-risk/utils/types';

  const DEFAULTS: AtRiskSettings = { enabled: true, inactiveDays: 14, lowProgressPct: 30, lowGradePct: 60 };

  const settingsStore = writable<AtRiskSettings>({ ...DEFAULTS });
  let initialized = $state(false);

  onMount(async () => {
    await atRiskSettingsApi.fetchSettings();
    settingsStore.set(atRiskSettingsApi.settings ?? DEFAULTS);
    initialized = true;
  });

  async function handleSave() {
    await atRiskSettingsApi.updateSettings($settingsStore);
  }
</script>

<svelte:head>
  <title>{$t('at_risk.settings.title')} - {brandName}</title>
</svelte:head>

<Page.Root class="mx-auto flex w-[90%] px-4 md:max-w-2xl lg:max-w-3xl">
  <Page.Header isSticky class="ui:bg-background z-10">
    <Page.HeaderContent>
      <Page.Title>{$t('at_risk.settings.title')}</Page.Title>
      <Page.Subtitle>{$t('at_risk.settings.subtitle')}</Page.Subtitle>
    </Page.HeaderContent>
    <Page.Action>
      <Button
        loading={atRiskSettingsApi.saving}
        disabled={atRiskSettingsApi.saving || !initialized}
        onclick={handleSave}
      >
        {$t('at_risk.settings.save')}
      </Button>
    </Page.Action>
  </Page.Header>

  <Page.Body>
    {#snippet child()}
      {#if !initialized}
        <p class="ui:text-muted-foreground text-sm">{$t('at_risk.settings.loading')}</p>
      {:else}
        <AtRiskSettingsForm store={settingsStore} disabled={atRiskSettingsApi.saving} />
      {/if}
    {/snippet}
  </Page.Body>
</Page.Root>
