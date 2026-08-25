<script lang="ts">
  import { onMount } from 'svelte';

  import * as Page from '@cio/ui/base/page';
  import InfoIcon from '@lucide/svelte/icons/info';

  import { EmailEditor, EmailList, buildEmailRows, emailsApi } from '$features/emails';
  import { brandName } from '$lib/utils/branding';
  import { t } from '$lib/utils/functions/translations';

  let seleccionado = $state('');

  onMount(() => {
    void emailsApi.fetchAll();
  });

  const filas = $derived(buildEmailRows(emailsApi.templates));
  const fila = $derived(filas.find((f) => f.key === seleccionado) ?? filas[0]);
  const template = $derived(fila?.emailId ? emailsApi.templateFor(fila.emailId) : undefined);

  /**
   * Elegir el primero apenas llegan los datos.
   *
   * Sin esto la mitad derecha arranca vacía y parece rota: la persona entra a
   * "Correos" y no ve ningún correo hasta que hace clic en algo.
   */
  $effect(() => {
    if (!seleccionado && filas.length > 0) seleccionado = filas[0].key;
  });
</script>

<svelte:head>
  <title>{$t('emails.title')} - {brandName}</title>
</svelte:head>

<Page.Root class="mx-auto flex w-[95%] px-2 2xl:max-w-[1500px]">
  <Page.Header isSticky class="ui:bg-background z-10">
    <Page.HeaderContent>
      <Page.Title>{$t('emails.title')}</Page.Title>
      <Page.Subtitle>{$t('emails.subtitle')}</Page.Subtitle>
    </Page.HeaderContent>
  </Page.Header>

  <Page.Body>
    {#snippet child()}
      {#if emailsApi.loading}
        <p class="ui:text-muted-foreground text-sm">{$t('emails.loading')}</p>
      {:else if emailsApi.loadFailed}
        <!-- "Cargando" y "falló" son estados distintos: si comparten uno, un
             error deja la pantalla girando y nadie se entera. -->
        <p class="ui:text-destructive text-sm">{$t('emails.load_failed')}</p>
      {:else}
        <div class="flex flex-col gap-5">
          {#if !emailsApi.canEditText}
            <div class="ui:border-border ui:bg-muted/40 flex items-start gap-3 rounded-lg border p-3">
              <InfoIcon size={15} class="ui:text-muted-foreground mt-0.5 shrink-0" />
              <p class="text-sm leading-relaxed">
                {$t('emails.inherited', { owner: emailsApi.textOwner?.name ?? '' })}
              </p>
            </div>
          {/if}

          <div class="grid items-start gap-6 xl:grid-cols-[minmax(280px,340px)_1fr]">
            <div class="xl:sticky xl:top-4">
              <EmailList
                selected={fila?.key ?? ''}
                onSelect={(key) => (seleccionado = key)}
                disabled={emailsApi.saving}
              />
            </div>

            <div>
              {#if template}
                <!--
                  `key` en el id: sin él Svelte reusa el mismo componente al
                  cambiar de correo y los campos se quedan con el texto anterior.
                -->
                {#key template.id}
                  <EmailEditor {template} editable={emailsApi.canEditText} />
                {/key}
              {:else}
                <p class="ui:text-muted-foreground text-sm">{$t('emails.no_text')}</p>
              {/if}
            </div>
          </div>
        </div>
      {/if}
    {/snippet}
  </Page.Body>
</Page.Root>
