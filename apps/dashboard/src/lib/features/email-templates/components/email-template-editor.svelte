<script lang="ts">
  import { Badge } from '@cio/ui/base/badge';
  import { Button } from '@cio/ui/base/button';
  import * as Field from '@cio/ui/base/field';
  import { Input } from '@cio/ui/base/input';
  import { Textarea } from '@cio/ui/base/textarea';

  import { t } from '$lib/utils/functions/translations';
  import { emailTemplatesApi, type EmailTemplateView } from '../api/email-templates.svelte';

  interface Props {
    template: EmailTemplateView;
    disabled?: boolean;
  }

  let { template, disabled = false }: Props = $props();

  // Copias locales para poder cancelar. El estado guardado vive en el store; esto
  // es sólo lo que la persona está escribiendo.
  let asunto = $state(template.subject ?? template.defaultSubject);
  let cuerpo = $state(template.body ?? template.defaultBody);

  let idCargado = $state(template.id);

  /**
   * Recargar los campos SÓLO al cambiar de correo.
   *
   * La guarda por id no es para conformar al linter: sin ella el efecto también
   * se dispara cuando el store refresca la lista —por ejemplo después de guardar
   * otro correo— y le borra a la persona lo que estaba escribiendo.
   */
  $effect(() => {
    if (idCargado === template.id) return;

    idCargado = template.id;
    asunto = template.subject ?? template.defaultSubject;
    cuerpo = template.body ?? template.defaultBody;
  });

  const sinGuardar = $derived(
    asunto !== (template.subject ?? template.defaultSubject) || cuerpo !== (template.body ?? template.defaultBody)
  );

  /**
   * Variables imprescindibles que el texto escrito ya no menciona.
   *
   * No bloquea el guardado —puede haber un motivo— pero avisa: una invitación
   * sin `{inviteLink}` es un correo que no sirve para nada, y eso no se descubre
   * hasta que alguien se queja de que no puede entrar.
   */
  const faltantes = $derived(template.requiredVariables.filter((v) => !cuerpo.includes(`{${v}}`)));

  function insertarVariable(nombre: string) {
    cuerpo += `{${nombre}}`;
  }

  async function guardar() {
    await emailTemplatesApi.save(template.id, { subject: asunto, body: cuerpo });
  }

  async function restaurar() {
    await emailTemplatesApi.reset(template.id);
  }
</script>

<Field.Group class="w-full">
  <Field.Field>
    <Field.Label for="asunto-{template.id}">{$t('email_templates.subject')}</Field.Label>
    <Input id="asunto-{template.id}" bind:value={asunto} {disabled} maxlength={200} />
  </Field.Field>

  <Field.Field>
    <Field.Label for="cuerpo-{template.id}">{$t('email_templates.body')}</Field.Label>
    <Textarea id="cuerpo-{template.id}" bind:value={cuerpo} {disabled} rows={14} class="font-mono text-sm" />
    <Field.Description class="text-sm">{$t('email_templates.body_help')}</Field.Description>
  </Field.Field>

  <Field.Field>
    <Field.Label>{$t('email_templates.variables')}</Field.Label>
    <Field.Description class="text-sm">{$t('email_templates.variables_help')}</Field.Description>
    <div class="flex flex-wrap gap-2">
      {#each template.variables as variable (variable)}
        <button
          type="button"
          {disabled}
          onclick={() => insertarVariable(variable)}
          class="ui:border-border ui:hover:bg-accent ui:focus-visible:ring-ring rounded border px-2 py-1 font-mono text-xs focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50"
        >
          {'{' + variable + '}'}
        </button>
      {/each}
    </div>
  </Field.Field>

  {#if faltantes.length > 0}
    <!--
      Aviso, no bloqueo: puede haber un motivo para sacar un enlace. Pero que
      nadie lo haga sin darse cuenta.
    -->
    <div class="ui:border-destructive/40 ui:bg-destructive/5 flex flex-col gap-1 rounded border p-3">
      <p class="text-sm font-semibold">{$t('email_templates.missing_warning')}</p>
      <div class="flex flex-wrap gap-2">
        {#each faltantes as variable (variable)}
          <Badge variant="destructive">{'{' + variable + '}'}</Badge>
        {/each}
      </div>
    </div>
  {/if}

  <div class="flex flex-wrap items-center gap-2">
    <Button onclick={guardar} disabled={disabled || !sinGuardar} loading={emailTemplatesApi.saving}>
      {$t('email_templates.save')}
    </Button>
    {#if template.isCustomized}
      <Button variant="outline" onclick={restaurar} disabled={disabled}>
        {$t('email_templates.reset')}
      </Button>
    {/if}
    {#if sinGuardar}
      <span class="ui:text-muted-foreground text-sm">{$t('email_templates.unsaved')}</span>
    {/if}
  </div>
</Field.Group>
