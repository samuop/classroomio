<script lang="ts">
  import * as Field from '@cio/ui/base/field';
  import { Switch } from '@cio/ui/base/switch';
  import { Badge } from '@cio/ui/base/badge';

  import { NOTIFICATION_AUDIENCE, notificationsFor, type TNotificationId } from '@cio/utils/validation/notifications';
  import { t } from '$lib/utils/functions/translations';
  import { notificationSettingsApi } from '../api/notifications.svelte';

  interface Props {
    disabled?: boolean;
  }

  let { disabled = false }: Props = $props();

  const grupos = [
    { audiencia: NOTIFICATION_AUDIENCE.STUDENT, clave: 'students' },
    { audiencia: NOTIFICATION_AUDIENCE.TEAM, clave: 'team' }
  ] as const;

  function estaEncendido(id: TNotificationId): boolean {
    return notificationSettingsApi.settings?.[id] ?? true;
  }

  function alternar(id: TNotificationId, valor: boolean) {
    void notificationSettingsApi.toggle(id, valor);
  }
</script>

<Field.Group class="w-full px-2">
  {#each grupos as grupo (grupo.clave)}
    <Field.Set>
      <Field.Legend>{$t(`notifications.settings.groups.${grupo.clave}.title`)}</Field.Legend>
      <Field.Description class="text-sm">
        {$t(`notifications.settings.groups.${grupo.clave}.description`)}
      </Field.Description>

      <Field.Group>
        {#each notificationsFor(grupo.audiencia) as aviso (aviso.id)}
          <Field.Field orientation="horizontal">
            <Field.Label class="flex flex-wrap items-center gap-2">
              {$t(`notifications.settings.items.${aviso.id}.title`)}
              {#if aviso.broadcast}
                <!--
                  Que un aviso vaya a TODO el equipo es el dato que explica por
                  que alguien querria apagarlo. Sin esto, "un alumno entrego un
                  ejercicio" parece un correo y son tantos como tutores tenga el
                  curso.
                -->
                <Badge variant="secondary">{$t('notifications.settings.broadcast')}</Badge>
              {/if}
            </Field.Label>
            <Switch
              checked={estaEncendido(aviso.id)}
              {disabled}
              onCheckedChange={(valor) => alternar(aviso.id, valor)}
              aria-label={$t(`notifications.settings.items.${aviso.id}.title`)}
            />
            <Field.Description class="text-sm">
              {$t(`notifications.settings.items.${aviso.id}.description`)}
            </Field.Description>
          </Field.Field>
        {/each}
      </Field.Group>
    </Field.Set>
  {/each}

  <Field.Set>
    <Field.Legend>{$t('notifications.settings.always.title')}</Field.Legend>
    <Field.Description class="text-sm">
      {$t('notifications.settings.always.description')}
    </Field.Description>
  </Field.Set>
</Field.Group>
