<script lang="ts">
  import { onMount } from 'svelte';

  import * as Accordion from '@cio/ui/base/accordion';
  import { Badge } from '@cio/ui/base/badge';
  import * as Page from '@cio/ui/base/page';

  import { EmailTemplateEditor, emailTemplatesApi } from '$features/email-templates';
  import { brandName } from '$lib/utils/branding';
  import { t } from '$lib/utils/functions/translations';

  let initialized = $state(false);

  onMount(async () => {
    await emailTemplatesApi.fetchTemplates();
    initialized = true;
  });

  /**
   * El nombre legible sale de las traducciones de la pantalla de avisos: son los
   * MISMOS correos, y tener dos juegos de nombres para lo mismo garantiza que
   * tarde o temprano digan cosas distintas.
   */
  function nombreDe(id: string): string {
    const clave = `notifications.settings.items.${id}.title`;
    const traducido = $t(clave);

    return traducido === clave ? id : traducido;
  }
</script>

<svelte:head>
  <title>{$t('email_templates.title')} - {brandName}</title>
</svelte:head>

<Page.Root class="mx-auto flex w-[90%] px-4 md:max-w-3xl">
  <Page.Header isSticky class="ui:bg-background z-10">
    <Page.HeaderContent>
      <Page.Title>{$t('email_templates.title')}</Page.Title>
      <Page.Subtitle>{$t('email_templates.subtitle')}</Page.Subtitle>
    </Page.HeaderContent>
  </Page.Header>

  <Page.Body>
    {#snippet child()}
      {#if !initialized}
        <p class="ui:text-muted-foreground text-sm">{$t('email_templates.loading')}</p>
      {:else}
        <Accordion.Root type="single" class="w-full">
          {#each emailTemplatesApi.templates as template (template.id)}
            <Accordion.Item value={template.id}>
              <Accordion.Trigger>
                <span class="flex flex-wrap items-center gap-2 text-left">
                  {nombreDe(template.id)}
                  {#if template.isCustomized}
                    <Badge variant="secondary">{$t('email_templates.customized')}</Badge>
                  {/if}
                </span>
              </Accordion.Trigger>
              <Accordion.Content>
                <EmailTemplateEditor {template} disabled={emailTemplatesApi.saving} />
              </Accordion.Content>
            </Accordion.Item>
          {/each}
        </Accordion.Root>
      {/if}
    {/snippet}
  </Page.Body>
</Page.Root>
