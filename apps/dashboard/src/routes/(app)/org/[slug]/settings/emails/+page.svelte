<script lang="ts">
  import * as Page from '@cio/ui/base/page';
  import InfoIcon from '@lucide/svelte/icons/info';

  import { EmailEditor, EmailList, buildEmailRows, emailsApi } from '$features/emails';
  import { brandName } from '$lib/utils/branding';
  import { currentOrg } from '$lib/utils/store/org';
  import { t } from '$lib/utils/functions/translations';

  let seleccionado = $state('');
  let pedido = $state(false);

  /**
   * Esperar a que la empresa esté elegida antes de pedir nada.
   *
   * El cliente de la API pone el encabezado `cio-org-id` leyendo `currentOrg`
   * **en el momento del pedido**, y ese store lo llena el arranque de la app,
   * que es asincrónico. Con `onMount` a secas, una recarga en frío de esta URL
   * dispara el pedido antes de que llegue la empresa: sale sin encabezado y la
   * API contesta 400 `ORG_ID_REQUIRED`. Pasó en producción.
   */
  $effect(() => {
    if (pedido || !$currentOrg?.id) return;

    pedido = true;
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
      {#if !pedido || emailsApi.loading}
        <!-- `!pedido` también: antes de que salga el pedido no hay nada cargado
             y sin esto la pantalla parpadea vacía, que se lee como rota. -->
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
