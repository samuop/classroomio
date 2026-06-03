import * as z from 'zod';

import { defineEmail } from '../send';
import { getDefaultTemplate } from '../templates';

export const programGoalReminderEmail = defineEmail({
  id: 'programGoalReminder',
  subject: 'Recordatorio: un objetivo de tu programa vence pronto',
  schema: z.object({
    orgName: z.string().min(1),
    programName: z.string().min(1),
    goalTitle: z.string().min(1),
    daysUntilDue: z.number().int(),
    completedCount: z.number().int(),
    requiredCount: z.number().int(),
    loginUrl: z.string().min(1)
  }),
  render: (fields) => {
    const dueLine =
      fields.daysUntilDue <= 0
        ? `<p>Este objetivo está <strong>vencido</strong>.</p>`
        : fields.daysUntilDue === 1
          ? `<p>Este objetivo vence <strong>mañana</strong>.</p>`
          : `<p>Este objetivo vence en <strong>${fields.daysUntilDue} días</strong>.</p>`;

    const progress = `${fields.completedCount} de ${fields.requiredCount} cursos completados`;

    const content = `
      <p>Hola,</p>
      <p>Te recordamos que el objetivo <strong>${fields.goalTitle}</strong> de tu programa <strong>${fields.programName}</strong> en ${fields.orgName} necesita tu atención.</p>
      ${dueLine}
      <p>Tu progreso hasta ahora: <strong>${progress}</strong>.</p>
      <p><a href="${fields.loginUrl}">Iniciá sesión</a> para continuar.</p>
      <p>Saludos,</p>
      <p>${fields.orgName}</p>
    `;

    return getDefaultTemplate(content);
  }
});
