import * as z from 'zod';

import { defineEmail } from '../send';

export const programGoalReminderEmail = defineEmail({
  id: 'programGoalReminder',
  schema: z.object({
    orgName: z.string().min(1),
    programName: z.string().min(1),
    goalTitle: z.string().min(1),
    daysUntilDue: z.number().int(),
    completedCount: z.number().int(),
    requiredCount: z.number().int(),
    loginUrl: z.string().min(1)
  }),
  /**
   * "vence mañana" no es un dato, es una frase que depende del dato. Se calcula
   * acá y llega al texto como una variable más: quien escribe el correo no tiene
   * por qué saber que atrás hay un `if`.
   *
   * Van en texto plano a propósito: se interpolan DESPUÉS de convertir
   * `*negrita*`, así que un asterisco acá saldría literal. La énfasis se pone en
   * la plantilla —`*{progress}*`— que es donde el admin también puede sacarla.
   */
  derived: (fields) => ({
    dueLine:
      fields.daysUntilDue <= 0
        ? 'Este objetivo está vencido.'
        : fields.daysUntilDue === 1
          ? 'Este objetivo vence mañana.'
          : `Este objetivo vence en ${fields.daysUntilDue} días.`,
    progress: `${fields.completedCount} de ${fields.requiredCount} cursos completados`
  }),
  blocks: {
    subject: 'Recordatorio: un objetivo de tu programa vence pronto',
    heading: '',
    body: 'Hola,\n\nTe recordamos que el objetivo *{goalTitle}* de tu programa *{programName}* en {orgName} necesita tu atención.\n\n{dueLine}\n\nTu progreso hasta ahora: *{progress}*.\n\nSaludos,\n{orgName}',
    ctaLabel: 'Continuar',
    ctaUrl: '{loginUrl}',
    footer: ''
  }
});
