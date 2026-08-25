import * as z from 'zod';

import { defineEmail } from '../send';

export const studentProgramWelcomeEmail = defineEmail({
  id: 'studentProgramWelcome',
  schema: z.object({
    orgName: z.string().min(1),
    programName: z.string().min(1),
    loginUrl: z.string().min(1)
  }),
  blocks: {
    subject: 'Ya tenés acceso a un programa — iniciá sesión para comenzar',
    heading: '',
    body: 'Hola,\n\nYa tenés acceso al programa *{programName}* en *{orgName}*.\n\nSi tenés algún inconveniente, escribile a tu instructor.\n\nSaludos,\n{orgName}',
    ctaLabel: 'Iniciar sesión',
    ctaUrl: '{loginUrl}',
    footer: ''
  }
});
