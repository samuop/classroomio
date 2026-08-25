import { NOTIFICATION_CATALOG, type TNotificationId } from '@cio/utils/validation/notifications';

import type { EmailTemplateView } from './api/emails.svelte';

export type EmailGroup = 'student' | 'team' | 'always';

export interface EmailRow {
  /** Clave de traducción y de selección. Es el id del correo, o el del aviso si no tiene texto. */
  key: string;
  /** La plantilla editable, o `null` si este aviso todavía se arma en el código. */
  emailId: string | null;
  /** El interruptor, o `null` si este correo se manda siempre. */
  notificationId: TNotificationId | null;
  broadcast: boolean;
  group: EmailGroup;
}

/**
 * Orden de los que no se pueden apagar.
 *
 * A mano y no alfabético porque cuenta una historia: primero entrar a la
 * empresa, después a un curso. Lo que no esté en la lista va al final, así un
 * correo nuevo aparece igual sin que haya que acordarse de tocar esto.
 */
const ORDEN_SIEMPRE = [
  'inviteTeacher',
  'studentOrgInvite',
  'studentCourseInvite',
  'studentCourseWelcome',
  'studentProgramWelcome'
];

/**
 * Las filas de la pantalla: los avisos que se pueden apagar, y después los que
 * se mandan siempre.
 *
 * Se arma del catálogo de avisos y del catálogo de correos, no de una lista
 * propia. Los dos ya existen y son la fuente de verdad de cada mitad; una
 * tercera lista acá sería la que se olvida de actualizar.
 */
export function buildEmailRows(templates: EmailTemplateView[]): EmailRow[] {
  const conAviso = new Set<string>();

  const filas: EmailRow[] = NOTIFICATION_CATALOG.map((aviso) => {
    const template = aviso.emailId ? templates.find((t) => t.id === aviso.emailId) : undefined;
    if (template) conAviso.add(template.id);

    return {
      key: template?.id ?? aviso.id,
      emailId: template?.id ?? null,
      notificationId: aviso.id,
      broadcast: Boolean(aviso.broadcast),
      group: aviso.audience as EmailGroup
    };
  });

  const siempre = templates
    .filter((t) => !conAviso.has(t.id))
    .sort((a, b) => posicion(a.id) - posicion(b.id))
    .map((t) => ({
      key: t.id,
      emailId: t.id,
      notificationId: null,
      broadcast: false,
      group: 'always' as const
    }));

  return [...filas, ...siempre];
}

function posicion(id: string): number {
  const indice = ORDEN_SIEMPRE.indexOf(id);

  return indice === -1 ? ORDEN_SIEMPRE.length : indice;
}
