<script lang="ts">
  import { t } from '$lib/utils/functions/translations';
  import { emailsApi, type EmailBlocks, type EmailPreview } from '../api/emails.svelte';

  interface Props {
    emailId: string;
    /** Lo que la persona está escribiendo, todavía sin guardar. */
    draft: Partial<EmailBlocks>;
  }

  let { emailId, draft }: Props = $props();

  let preview = $state<EmailPreview | null>(null);
  let cargando = $state(false);
  let fallo = $state(false);

  /**
   * Cada pedido lleva número, y sólo el último manda.
   *
   * Sin esto, una respuesta lenta que llega después de una rápida pinta encima
   * el resultado viejo: la persona sigue escribiendo y la vista previa retrocede.
   */
  let secuencia = 0;

  $effect(() => {
    // Leerlos acá adentro es lo que hace que el efecto vuelva a correr al
    // escribir. `JSON.stringify` porque `draft` es un objeto nuevo en cada
    // render y comparar por identidad dispararía siempre.
    const id = emailId;
    const cuerpo = JSON.stringify(draft);

    const mio = ++secuencia;
    cargando = true;

    const temporizador = setTimeout(async () => {
      const resultado = await emailsApi.preview(id, JSON.parse(cuerpo));

      // Llegó tarde: ya hay uno más nuevo en camino.
      if (secuencia !== mio) return;

      if (resultado) {
        preview = resultado;
        fallo = false;
      } else {
        fallo = true;
      }

      cargando = false;
    }, 400);

    return () => clearTimeout(temporizador);
  });
</script>

<div class="flex flex-col gap-2">
  <div class="flex items-center justify-between">
    <h3 class="ui:text-muted-foreground text-xs font-semibold tracking-wider uppercase">
      {$t('emails.preview.title')}
    </h3>
    {#if cargando}
      <span class="ui:text-muted-foreground text-[10px]">{$t('emails.preview.updating')}</span>
    {/if}
  </div>

  <div class="ui:border-border overflow-hidden rounded-xl border transition-opacity" class:opacity-60={cargando}>
    <div class="ui:bg-muted ui:border-border border-b px-4 py-2.5">
      <p class="ui:text-muted-foreground text-[10px] font-bold tracking-wider uppercase">
        {$t('emails.preview.subject')}
      </p>
      <p class="truncate text-sm font-semibold">{preview?.subject ?? '…'}</p>
    </div>

    {#if preview}
      <!--
        En un iframe con `sandbox=""`: el correo trae sus propios estilos en
        línea y su propio `<body>`, así que inyectarlo en la página lo dejaría
        pisándose con el dashboard. Aislado se ve como lo que es.
      -->
      <iframe
        title={$t('emails.preview.title')}
        srcdoc={preview.html}
        sandbox=""
        class="block h-[520px] w-full border-0 bg-[#F1EDF6]"
      ></iframe>
    {:else}
      <div class="ui:bg-muted/40 flex h-[520px] items-center justify-center px-6 text-center">
        <p class="ui:text-muted-foreground text-sm">
          {fallo ? $t('emails.preview.failed') : $t('emails.preview.loading')}
        </p>
      </div>
    {/if}
  </div>

  <p class="ui:text-muted-foreground text-xs">{$t('emails.preview.help')}</p>
</div>
