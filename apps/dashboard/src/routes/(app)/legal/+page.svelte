<script lang="ts">
  import * as Page from '@cio/ui/base/page';
  import { t } from '$lib/utils/functions/translations';
  import { brandName, sourceCodeUrl, supportEmail } from '$lib/utils/branding';

  const AGPL_URL = 'https://www.gnu.org/licenses/agpl-3.0.html';
  const UPSTREAM_URL = 'https://github.com/rotimi-best/classroomio';
</script>

<svelte:head>
  <title>{$t('legal.title')}</title>
</svelte:head>

<Page.Root class="w-full md:max-w-3xl lg:mx-auto">
  <Page.Header>
    <Page.HeaderContent>
      <Page.Title>{$t('legal.title')}</Page.Title>
      <Page.Subtitle>{$t('legal.subtitle')}</Page.Subtitle>
    </Page.HeaderContent>
  </Page.Header>
  <Page.Body>
    {#snippet child()}
      <div class="space-y-6 px-1 py-2 text-sm leading-relaxed">
        <section class="space-y-2">
          <h3 class="text-base font-semibold">{$t('legal.attribution_heading')}</h3>
          <p class="ui:text-muted-foreground">
            {$t('legal.attribution_body', { brand: brandName })}
          </p>
        </section>

        <section class="space-y-2">
          <h3 class="text-base font-semibold">{$t('legal.license_heading')}</h3>
          <p class="ui:text-muted-foreground">
            {$t('legal.license_body')}
            <a href={AGPL_URL} target="_blank" rel="noopener" class="ui:text-primary underline underline-offset-2">
              GNU AGPL-3.0
            </a>.
          </p>
        </section>

        <section class="space-y-2">
          <h3 class="text-base font-semibold">{$t('legal.source_heading')}</h3>
          <p class="ui:text-muted-foreground">{$t('legal.source_body')}</p>
          <ul class="ui:text-muted-foreground list-inside list-disc space-y-1">
            <li>
              {$t('legal.source_this')}:
              <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- external absolute URL from env -->
              <a href={sourceCodeUrl} target="_blank" rel="noopener" class="ui:text-primary underline underline-offset-2">
                {sourceCodeUrl}
              </a>
            </li>
            <li>
              {$t('legal.source_upstream')}:
              <a href={UPSTREAM_URL} target="_blank" rel="noopener" class="ui:text-primary underline underline-offset-2">
                ClassroomIO
              </a>
            </li>
          </ul>
        </section>

        {#if supportEmail}
          <section class="space-y-2">
            <h3 class="text-base font-semibold">{$t('legal.contact_heading')}</h3>
            <p class="ui:text-muted-foreground">
              <a href={`mailto:${supportEmail}`} class="ui:text-primary underline underline-offset-2">
                {supportEmail}
              </a>
            </p>
          </section>
        {/if}
      </div>
    {/snippet}
  </Page.Body>
</Page.Root>
