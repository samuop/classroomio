import type { TNotificationId, TResolvedNotificationSettings } from '@cio/utils/validation/notifications';

import { BaseApiWithErrors, classroomio } from '$lib/utils/services/api';
import { snackbar } from '$features/ui/snackbar/store';

/** Los seis bloques editables de un correo. Espeja `@cio/email`. */
export interface EmailBlocks {
  subject: string;
  heading: string;
  body: string;
  ctaLabel: string;
  ctaUrl: string;
  footer: string;
}

export type EmailBlockKey = keyof EmailBlocks;

export const EMAIL_BLOCK_KEYS: EmailBlockKey[] = ['subject', 'heading', 'body', 'ctaLabel', 'ctaUrl', 'footer'];

export interface EmailTemplateView {
  id: string;
  defaults: EmailBlocks;
  values: EmailBlocks;
  overrides: Record<EmailBlockKey, string | null>;
  variables: string[];
  requiredVariables: string[];
  isCustomized: boolean;
  notificationId: TNotificationId | null;
  mandatory: boolean;
}

interface EmailsPayload {
  templates: EmailTemplateView[];
  toggles: TResolvedNotificationSettings;
  textOwner: { id: string; name: string | null };
  canEditText: boolean;
}

export interface EmailPreview {
  subject: string;
  html: string;
}

/**
 * Los correos automáticos: qué dicen y cuáles se mandan.
 *
 * Una sola clase para las dos cosas porque son la misma pregunta. Estaban en
 * dos pantallas que no se mencionaban entre sí, y para saber si a un alumno le
 * iba a llegar algo —y qué— había que abrir las dos y cruzarlas de memoria.
 */
class EmailsApi extends BaseApiWithErrors {
  templates = $state<EmailTemplateView[]>([]);
  toggles = $state<TResolvedNotificationSettings | null>(null);
  textOwner = $state<{ id: string; name: string | null } | null>(null);
  canEditText = $state(true);

  loading = $state(false);
  /**
   * Tercer estado, y no la ausencia de datos.
   *
   * "Cargando" y "falló" son cosas distintas: si comparten estado, un error deja
   * la pantalla girando para siempre y nadie se entera de que hubo un error.
   */
  loadFailed = $state(false);
  saving = $state(false);
  sendingTest = $state(false);

  async fetchAll() {
    this.loading = true;
    this.loadFailed = false;

    try {
      await this.execute({
        requestFn: () => classroomio.organization['email-templates'].$get(),
        logContext: 'fetching emails',
        onSuccess: (response) => this.aplicar((response as { data: EmailsPayload }).data),
        onError: () => {
          this.loadFailed = true;
        }
      });
    } finally {
      this.loading = false;
    }
  }

  private aplicar(payload: EmailsPayload) {
    this.templates = payload.templates;
    this.toggles = payload.toggles;
    this.textOwner = payload.textOwner;
    this.canEditText = payload.canEditText;
  }

  templateFor(id: string): EmailTemplateView | undefined {
    return this.templates.find((t) => t.id === id);
  }

  /** `null` en un bloque = ese vuelve al texto original. */
  async saveBlocks(emailId: string, blocks: Partial<Record<EmailBlockKey, string | null>>) {
    this.saving = true;

    try {
      await this.execute({
        requestFn: () =>
          classroomio.organization['email-templates'][':emailId'].$put({
            param: { emailId },
            json: { blocks }
          }),
        logContext: 'updating email template',
        onSuccess: (response) => {
          this.aplicar((response as { data: EmailsPayload }).data);
          snackbar.success('emails.saved');
        },
        onError: () => snackbar.error('emails.save_failed')
      });
    } finally {
      this.saving = false;
    }
  }

  async reset(emailId: string) {
    this.saving = true;

    try {
      await this.execute({
        requestFn: () => classroomio.organization['email-templates'][':emailId'].$delete({ param: { emailId } }),
        logContext: 'resetting email template',
        onSuccess: (response) => {
          this.aplicar((response as { data: EmailsPayload }).data);
          snackbar.success('emails.reset_done');
        },
        onError: () => snackbar.error('emails.save_failed')
      });
    } finally {
      this.saving = false;
    }
  }

  /**
   * Prender o apagar un correo.
   *
   * Optimista: el interruptor responde al toque y se revierte si falla. Uno que
   * espera medio segundo se siente roto y la gente lo toca dos veces.
   */
  async setEnabled(notificationId: TNotificationId, enabled: boolean, emailId?: string) {
    const previo = this.toggles;
    if (previo) this.toggles = { ...previo, [notificationId]: enabled };

    this.saving = true;

    try {
      await this.execute({
        // Por la ruta del correo cuando tiene plantilla, y por la de avisos
        // cuando no la tiene: los dos que se arman en código todavía no son un
        // `emailId` que la API reconozca.
        requestFn: () =>
          emailId
            ? classroomio.organization['email-templates'][':emailId'].$put({
                param: { emailId },
                json: { enabled }
              })
            : classroomio.organization.notifications.$put({ json: { [notificationId]: enabled } }),
        logContext: 'toggling email',
        onSuccess: (response) => {
          const data = (response as { data: EmailsPayload | TResolvedNotificationSettings }).data;

          if ('templates' in data) this.aplicar(data);
          else this.toggles = data;
        },
        onError: () => {
          if (previo) this.toggles = previo;
          snackbar.error('emails.save_failed');
        }
      });
    } finally {
      this.saving = false;
    }
  }

  /**
   * El correo renderizado por el servidor, con datos de ejemplo.
   *
   * Es lo que reemplaza a editar HTML a ciegas. Devuelve `null` en vez de tirar:
   * una vista previa que no llegó no puede romper la pantalla donde la persona
   * está escribiendo.
   */
  async preview(emailId: string, draft: Partial<EmailBlocks>): Promise<EmailPreview | null> {
    let resultado: EmailPreview | null = null;

    await this.execute({
      requestFn: () =>
        classroomio.organization['email-templates'][':emailId'].preview.$post({
          param: { emailId },
          json: { draft }
        }),
      logContext: 'rendering email preview',
      onSuccess: (response) => {
        resultado = (response as { data: EmailPreview }).data;
      },
      onError: () => {
        resultado = null;
      }
    });

    return resultado;
  }

  async sendTest(emailId: string, email: string, draft: Partial<EmailBlocks>): Promise<boolean> {
    let enviado = false;
    this.sendingTest = true;

    try {
      await this.execute({
        requestFn: () =>
          classroomio.organization['email-templates'][':emailId'].test.$post({
            param: { emailId },
            json: { email, draft }
          }),
        logContext: 'sending test email',
        onSuccess: () => {
          enviado = true;
          snackbar.success('emails.test.sent');
        },
        onError: () => snackbar.error('emails.test.failed')
      });
    } finally {
      this.sendingTest = false;
    }

    return enviado;
  }
}

export const emailsApi = new EmailsApi();
