import * as z from 'zod';

import { defineEmail } from '../send';

export const studentCourseWelcomeEmail = defineEmail({
  id: 'studentCourseWelcome',
  schema: z.object({
    orgName: z.string().min(1),
    courseName: z.string().min(1),
    loginUrl: z.string().min(1)
  }),
  blocks: {
    subject: 'Ya tenés acceso a un curso — iniciá sesión para comenzar',
    heading: '',
    body: 'Hola,\n\nYa tenés acceso al curso *{courseName}* en *{orgName}*.\n\nSi tenés algún inconveniente, escribile a tu instructor.\n\nSaludos,\n{orgName}',
    ctaLabel: 'Iniciar sesión',
    ctaUrl: '{loginUrl}',
    footer: ''
  }
});
