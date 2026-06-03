import * as z from 'zod';

import { defineEmail } from '../send';
import { getDefaultTemplate } from '../templates';

export const studentProvePaymentEmail = defineEmail({
  id: 'studentProvePayment',
  subject: 'Falta un paso',
  schema: z.object({
    courseName: z.string().min(1),
    teacherEmail: z.email(),
    studentFullname: z.string().min(1),
    orgName: z.string().min(1)
  }),
  render: (fields) => {
    const content = `
      <p>Hola ${fields.studentFullname},</p>
      <p>Estás a un paso de sumarte a: <strong>${fields.courseName}</strong></p>
      <p>Enviá tu comprobante de pago a: <strong>${fields.teacherEmail}</strong> para poder ingresar al curso.</p>
      <p>¡Nos vemos en clase!</p>
      <p>${fields.orgName}</p>
    `;

    return getDefaultTemplate(content);
  }
});
