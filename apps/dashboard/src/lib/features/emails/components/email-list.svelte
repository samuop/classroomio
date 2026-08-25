<script lang="ts">
  import { Badge } from '@cio/ui/base/badge';
  import { Switch } from '@cio/ui/base/switch';
  import LockIcon from '@lucide/svelte/icons/lock';

  import { t } from '$lib/utils/functions/translations';
  import { emailsApi } from '../api/emails.svelte';
  import { buildEmailRows, type EmailGroup, type EmailRow } from '../rows';

  interface Props {
    selected: string;
    onSelect: (key: string) => void;
    disabled?: boolean;
  }

  let { selected, onSelect, disabled = false }: Props = $props();

  const filas = $derived(buildEmailRows(emailsApi.templates));
  const grupos: EmailGroup[] = ['student', 'team', 'always'];

  function encendido(fila: EmailRow): boolean {
    if (!fila.notificationId) return true;

    return emailsApi.toggles?.[fila.notificationId] ?? true;
  }

  function alternar(fila: EmailRow, valor: boolean) {
    if (!fila.notificationId) return;

    void emailsApi.setEnabled(fila.notificationId, valor, fila.emailId ?? undefined);
  }
</script>

<div class="flex flex-col gap-6">
  {#each grupos as grupo (grupo)}
    {@const delGrupo = filas.filter((f) => f.group === grupo)}
    {#if delGrupo.length > 0}
      <section class="flex flex-col gap-2">
        <div>
          <h2 class="text-sm font-semibold">{$t(`emails.groups.${grupo}.title`)}</h2>
          <p class="ui:text-muted-foreground text-xs leading-relaxed">
            {$t(`emails.groups.${grupo}.description`)}
          </p>
        </div>

        <ul class="flex flex-col gap-1.5">
          {#each delGrupo as fila (fila.key)}
            {@const activo = fila.key === selected}
            {@const template = fila.emailId ? emailsApi.templateFor(fila.emailId) : undefined}
            <li>
              <div
                class="ui:border-border flex items-start gap-3 rounded-lg border p-3 transition-colors {activo
                  ? 'ui:border-primary ui:bg-accent'
                  : 'ui:hover:bg-accent/50'}"
              >
                <!--
                  El botón envuelve sólo el texto, no la fila entera: adentro hay
                  un interruptor, y un botón dentro de otro botón no es HTML
                  válido — el navegador lo desarma y el interruptor deja de
                  responder al teclado.
                -->
                <button
                  type="button"
                  class="min-w-0 flex-1 text-left"
                  aria-current={activo}
                  onclick={() => onSelect(fila.key)}
                >
                  <span class="flex flex-wrap items-center gap-1.5">
                    <span class="text-sm font-medium">{$t(`emails.items.${fila.key}.title`)}</span>
                    {#if template?.isCustomized}
                      <Badge variant="secondary" class="text-[10px]">{$t('emails.customized')}</Badge>
                    {/if}
                    {#if fila.broadcast}
                      <Badge variant="outline" class="text-[10px]">{$t('emails.broadcast')}</Badge>
                    {/if}
                  </span>
                  <span class="ui:text-muted-foreground mt-0.5 block text-xs leading-relaxed">
                    {$t(`emails.items.${fila.key}.description`)}
                  </span>
                </button>

                {#if fila.notificationId}
                  <div class="flex shrink-0 flex-col items-end gap-1">
                    <Switch
                      checked={encendido(fila)}
                      {disabled}
                      onCheckedChange={(valor) => alternar(fila, valor)}
                      aria-label={$t(`emails.items.${fila.key}.title`)}
                    />
                    <span class="ui:text-muted-foreground text-[10px] font-bold tracking-wider">
                      {encendido(fila) ? $t('emails.state.on') : $t('emails.state.off')}
                    </span>
                  </div>
                {:else}
                  <!--
                    Candado y no un interruptor apagado: un control que no
                    obedece es peor que no tener control. Sin estos correos nadie
                    entra a la plataforma.
                  -->
                  <div
                    class="ui:text-muted-foreground flex shrink-0 items-center gap-1"
                    title={$t('emails.always_hint')}
                  >
                    <LockIcon size={11} />
                    <span class="text-[10px] font-bold tracking-wider">{$t('emails.state.always')}</span>
                  </div>
                {/if}
              </div>
            </li>
          {/each}
        </ul>
      </section>
    {/if}
  {/each}
</div>
