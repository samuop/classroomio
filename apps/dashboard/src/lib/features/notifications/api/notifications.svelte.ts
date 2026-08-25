import {
  ZNotificationSettingsUpdate,
  type TNotificationId,
  type TResolvedNotificationSettings
} from '@cio/utils/validation/notifications';

import { BaseApiWithErrors, classroomio } from '$lib/utils/services/api';
import { mapZodErrorsToTranslations } from '$lib/utils/validation';
import { snackbar } from '$features/ui/snackbar/store';

/**
 * Qué correos automáticos manda la empresa.
 *
 * Espeja a `AtRiskSettingsApi`: leer lo puede cualquier miembro, guardar sólo el
 * admin (lo impone la API, no esta clase).
 */
class NotificationSettingsApi extends BaseApiWithErrors {
  settings = $state<TResolvedNotificationSettings | null>(null);
  loading = $state(false);
  saving = $state(false);

  async fetchSettings() {
    this.loading = true;

    try {
      await this.execute({
        requestFn: () => classroomio.organization.notifications.$get(),
        logContext: 'fetching org notification settings',
        onSuccess: (response) => {
          this.settings = (response as { data: TResolvedNotificationSettings }).data;
        }
      });
    } finally {
      this.loading = false;
    }
  }

  /**
   * Guarda UN interruptor.
   *
   * De a uno y no la pantalla entera a propósito: el PUT es un parche, así que
   * mandar sólo lo que cambió evita pisar un aviso que otra persona tocó
   * mientras esta pestaña estaba abierta.
   */
  async toggle(id: TNotificationId, enabled: boolean) {
    const patch = { [id]: enabled };
    const result = ZNotificationSettingsUpdate.safeParse(patch);

    if (!result.success) {
      this.errors = mapZodErrorsToTranslations(result.error);
      return;
    }

    // Optimista: el interruptor responde al toque y se revierte si falla. Un
    // switch que espera medio segundo se siente roto y la gente lo toca dos
    // veces.
    const previo = this.settings;
    if (previo) this.settings = { ...previo, [id]: enabled };

    this.saving = true;

    try {
      await this.execute({
        requestFn: () => classroomio.organization.notifications.$put({ json: result.data }),
        logContext: 'updating org notification settings',
        onSuccess: (response) => {
          this.settings = (response as { data: TResolvedNotificationSettings }).data;
          this.errors = {};
        },
        onError: () => {
          if (previo) this.settings = previo;
          snackbar.error('notifications.settings.save_failed');
        }
      });
    } finally {
      this.saving = false;
    }
  }
}

export const notificationSettingsApi = new NotificationSettingsApi();
