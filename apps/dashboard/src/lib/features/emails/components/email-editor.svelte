<script lang="ts">
  import { Badge } from '@cio/ui/base/badge';
  import { Button } from '@cio/ui/base/button';
  import * as Field from '@cio/ui/base/field';
  import { Input } from '@cio/ui/base/input';
  import { Switch } from '@cio/ui/base/switch';
  import { Textarea } from '@cio/ui/base/textarea';
  import SendIcon from '@lucide/svelte/icons/send';

  import { t } from '$lib/utils/functions/translations';
  import {
    EMAIL_BLOCK_KEYS,
    emailsApi,
    type EmailBlockKey,
    type EmailBlocks,
    type EmailTemplateView
  } from '../api/emails.svelte';
  import EmailPreview from './email-preview.svelte';

  interface Props {
    template: EmailTemplateView;
    /** `false` cuando los textos los define la consultora de arriba. */
    editable?: boolean;
  }

  let { template, editable = true }: Props = $props();

  /** Los seis bloques, tal como están en el formulario. */
  let form = $state<EmailBlocks>({ ...template.values });
  /** Un botón sin texto es un correo sin botón, y eso es una elección válida. */
  let conBoton = $state(template.values.ctaLabel.trim() !== '');
  let campos = $state<Partial<Record<EmailBlockKey, HTMLInputElement | HTMLTextAreaElement | null>>>({});
  let campoActivo = $state<EmailBlockKey>('body');

  let correoPrueba = $state('');
  let errorPrueba = $state('');

  /**
   * El formulario arranca UNA vez y no se sincroniza con `template`.
   *
   * Es a propósito: el store refresca la lista cada vez que se guarda o se toca
   * un interruptor, y volver a copiar `template.values` en cada refresco le
   * borraría a la persona lo que está escribiendo. Cambiar de correo remonta
   * este componente entero (el `{#key}` de la pantalla), que es lo que sí tiene
   * que recargar los campos.
   */

  /** Lo que se ve en la vista previa: el borrador, no lo guardado. */
  const draft = $derived<Partial<EmailBlocks>>({ ...form, ctaLabel: conBoton ? form.ctaLabel : '' });

  const sinGuardar = $derived(EMAIL_BLOCK_KEYS.some((k) => (draft[k] ?? '') !== template.values[k]));

  /**
   * Variables imprescindibles que el texto ya no menciona.
   *
   * No bloquea el guardado —puede haber un motivo— pero avisa: una invitación
   * sin el enlace es un correo que no sirve para nada, y eso no se descubre
   * hasta que alguien se queja de que no puede entrar.
   */
  const faltantes = $derived(
    template.requiredVariables.filter((v) => !`${form.body} ${conBoton ? form.ctaUrl : ''}`.includes(`{${v}}`))
  );

  function insertarVariable(nombre: string) {
    const marcador = `{${nombre}}`;
    const clave = campoActivo;
    const elemento = campos[clave];

    if (!elemento) {
      form[clave] = `${form[clave]}${marcador}`;
      return;
    }

    const desde = elemento.selectionStart ?? form[clave].length;
    const hasta = elemento.selectionEnd ?? desde;

    form[clave] = `${form[clave].slice(0, desde)}${marcador}${form[clave].slice(hasta)}`;

    // Devolver el foco con el cursor después de lo insertado: sin esto hay que
    // volver a hacer clic en el campo para seguir escribiendo.
    queueMicrotask(() => {
      elemento.focus();
      elemento.setSelectionRange(desde + marcador.length, desde + marcador.length);
    });
  }

  /**
   * Sólo se guarda lo que difiere del texto original.
   *
   * Lo que quedó igual se manda como `null` a propósito: así ese bloque sigue
   * atado al original y, si mañana el original mejora, esta empresa recibe la
   * mejora en vez de quedar con una copia vieja de lo mismo.
   */
  function overrideONull(clave: EmailBlockKey): string | null {
    const valor = draft[clave] ?? '';

    return valor === template.defaults[clave] ? null : valor;
  }

  async function guardar() {
    await emailsApi.saveBlocks(
      template.id,
      Object.fromEntries(EMAIL_BLOCK_KEYS.map((k) => [k, overrideONull(k)])) as Record<EmailBlockKey, string | null>
    );
  }

  /** Descarta lo escrito y vuelve al original, sin guardar todavía. */
  function restaurar() {
    form = { ...template.defaults };
    conBoton = template.defaults.ctaLabel.trim() !== '';
  }

  async function enviarPrueba() {
    const correo = correoPrueba.trim();

    if (!correo.includes('@')) {
      errorPrueba = $t('emails.test.invalid');
      return;
    }

    errorPrueba = '';
    await emailsApi.sendTest(template.id, correo, draft);
  }
</script>

<div class="grid items-start gap-6 2xl:grid-cols-2">
  <Field.Group class="w-full">
    <Field.Field>
      <Field.Label for="asunto-{template.id}">{$t('emails.fields.subject')}</Field.Label>
      <Input
        id="asunto-{template.id}"
        bind:value={form.subject}
        bind:ref={campos.subject}
        onfocus={() => (campoActivo = 'subject')}
        disabled={!editable}
        maxlength={200}
      />
      <Field.Description class="text-sm">{$t('emails.fields.subject_help')}</Field.Description>
    </Field.Field>

    <Field.Field>
      <Field.Label for="titulo-{template.id}">{$t('emails.fields.heading')}</Field.Label>
      <Input
        id="titulo-{template.id}"
        bind:value={form.heading}
        bind:ref={campos.heading}
        onfocus={() => (campoActivo = 'heading')}
        disabled={!editable}
        maxlength={300}
      />
      <Field.Description class="text-sm">{$t('emails.fields.heading_help')}</Field.Description>
    </Field.Field>

    <Field.Field>
      <Field.Label for="cuerpo-{template.id}">{$t('emails.fields.body')}</Field.Label>
      <Textarea
        id="cuerpo-{template.id}"
        bind:value={form.body}
        bind:ref={campos.body}
        onfocus={() => (campoActivo = 'body')}
        disabled={!editable}
        rows={10}
        maxlength={5000}
      />
      <Field.Description class="text-sm">{$t('emails.fields.body_help')}</Field.Description>
    </Field.Field>

    <Field.Set class="ui:border-border rounded-lg border p-4">
      <div class="flex items-center justify-between gap-3">
        <Field.Legend class="text-sm">{$t('emails.fields.cta')}</Field.Legend>
        <div class="flex items-center gap-2">
          <span class="ui:text-muted-foreground text-[10px] font-bold tracking-wider">
            {conBoton ? $t('emails.fields.cta_on') : $t('emails.fields.cta_off')}
          </span>
          <Switch
            checked={conBoton}
            disabled={!editable}
            onCheckedChange={(valor) => (conBoton = valor)}
            aria-label={$t('emails.fields.cta')}
          />
        </div>
      </div>

      {#if conBoton}
        <Field.Group class="mt-3">
          <Field.Field>
            <Field.Label for="cta-texto-{template.id}">{$t('emails.fields.cta_label')}</Field.Label>
            <Input
              id="cta-texto-{template.id}"
              bind:value={form.ctaLabel}
              bind:ref={campos.ctaLabel}
              onfocus={() => (campoActivo = 'ctaLabel')}
              disabled={!editable}
              maxlength={80}
            />
          </Field.Field>
          <Field.Field>
            <Field.Label for="cta-url-{template.id}">{$t('emails.fields.cta_url')}</Field.Label>
            <Input
              id="cta-url-{template.id}"
              bind:value={form.ctaUrl}
              bind:ref={campos.ctaUrl}
              onfocus={() => (campoActivo = 'ctaUrl')}
              disabled={!editable}
              maxlength={500}
              class="font-mono text-sm"
            />
            <Field.Description class="text-sm">{$t('emails.fields.cta_url_help')}</Field.Description>
          </Field.Field>
        </Field.Group>
      {/if}
    </Field.Set>

    <Field.Field>
      <Field.Label for="pie-{template.id}">{$t('emails.fields.footer')}</Field.Label>
      <Textarea
        id="pie-{template.id}"
        bind:value={form.footer}
        bind:ref={campos.footer}
        onfocus={() => (campoActivo = 'footer')}
        disabled={!editable}
        rows={2}
        maxlength={1000}
      />
      <Field.Description class="text-sm">{$t('emails.fields.footer_help')}</Field.Description>
    </Field.Field>

    {#if editable}
      <Field.Field>
        <Field.Label>{$t('emails.variables.title')}</Field.Label>
        <Field.Description class="text-sm">{$t('emails.variables.help')}</Field.Description>
        <div class="flex flex-wrap gap-2">
          {#each template.variables as variable (variable)}
            <button
              type="button"
              onclick={() => insertarVariable(variable)}
              class="ui:border-border ui:hover:border-primary ui:focus-visible:ring-ring rounded border px-2 py-1 font-mono text-xs focus-visible:ring-2 focus-visible:outline-none"
            >
              {'{' + variable + '}'}
            </button>
          {/each}
        </div>
      </Field.Field>
    {/if}

    {#if faltantes.length > 0}
      <!--
      Aviso, no bloqueo: puede haber un motivo para sacar un enlace. Pero que
      nadie lo haga sin darse cuenta.
    -->
      <div class="ui:border-destructive/40 ui:bg-destructive/5 flex flex-col gap-1 rounded border p-3">
        <p class="text-sm font-semibold">{$t('emails.missing_warning')}</p>
        <div class="flex flex-wrap gap-2">
          {#each faltantes as variable (variable)}
            <Badge variant="destructive">{'{' + variable + '}'}</Badge>
          {/each}
        </div>
      </div>
    {/if}

    {#if editable}
      <div class="flex flex-wrap items-center gap-2">
        <Button onclick={guardar} disabled={!sinGuardar} loading={emailsApi.saving}>
          {$t('emails.save')}
        </Button>
        {#if template.isCustomized || sinGuardar}
          <Button variant="outline" onclick={restaurar}>{$t('emails.reset')}</Button>
        {/if}
        {#if sinGuardar}
          <span class="ui:text-muted-foreground text-sm">{$t('emails.unsaved')}</span>
        {/if}
      </div>

      <div class="ui:border-border flex flex-col gap-2 rounded-lg border border-dashed p-4">
        <p class="ui:text-muted-foreground text-xs font-semibold tracking-wider uppercase">
          {$t('emails.test.title')}
        </p>
        <div class="flex flex-wrap items-center gap-2">
          <Input
            type="email"
            bind:value={correoPrueba}
            placeholder={$t('emails.test.placeholder')}
            onkeydown={(evento) => evento.key === 'Enter' && enviarPrueba()}
            class="min-w-[200px] flex-1"
          />
          <Button variant="outline" onclick={enviarPrueba} loading={emailsApi.sendingTest}>
            <SendIcon size={14} />
            {$t('emails.test.send')}
          </Button>
        </div>
        {#if errorPrueba}
          <p class="ui:text-destructive text-sm">{errorPrueba}</p>
        {/if}
        <p class="ui:text-muted-foreground text-xs">{$t('emails.test.help')}</p>
      </div>
    {/if}
  </Field.Group>

  <div class="2xl:sticky 2xl:top-4">
    <EmailPreview emailId={template.id} {draft} />
  </div>
</div>
