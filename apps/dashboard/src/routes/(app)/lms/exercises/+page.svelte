<script lang="ts">
  import { brandName } from '$lib/utils/branding';
  import { ExercisesPage } from '$features/lms/pages';
  import { t } from '$lib/utils/functions/translations';
  import * as Page from '@cio/ui/base/page';
</script>

<svelte:head>
  <title>Exercises - {brandName}</title>
</svelte:head>

<Page.Root class="w-full">
  <Page.Header>
    <Page.HeaderContent>
      <Page.Title>{$t('exercises.heading')}</Page.Title>
      <Page.Subtitle>{$t('exercises.subheading')}</Page.Subtitle>
    </Page.HeaderContent>
  </Page.Header>
  <Page.Body>
    {#snippet child()}
      <ExercisesPage />
    {/snippet}
  </Page.Body>
</Page.Root>
