import * as z from 'zod';

import { defineEmail } from '../send';

export const studentProvePaymentEmail = defineEmail({
  id: 'studentProvePayment',
  schema: z.object({
    courseName: z.string().min(1),
    teacherEmail: z.email(),
    studentFullname: z.string().min(1),
    orgName: z.string().min(1)
  }),
  blocks: {
    subject: 'Falta un paso',
    heading: '',
    body: 'Hola {studentFullname},\n\nEstás a un paso de sumarte a: *{courseName}*\n\nEnviá tu comprobante de pago a: *{teacherEmail}* para poder ingresar al curso.\n\n¡Nos vemos en clase!\n{orgName}',
    ctaLabel: '',
    ctaUrl: '',
    footer: ''
  }
});
