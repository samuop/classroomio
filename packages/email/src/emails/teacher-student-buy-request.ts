import * as z from 'zod';

import { defineEmail } from '../send';
import { getDefaultTemplate } from '../templates';

export const teacherStudentBuyRequestEmail = defineEmail({
  id: 'teacherStudentBuyRequest',
  subject: '¡Solicitud para unirse a un curso!',
  schema: z.object({
    courseName: z.string().min(1),
    studentEmail: z.string().email(),
    studentFullname: z.string().min(1)
  }),
  render: (fields) => {
    const content = `
      <p>Hola,</p>
      <p>Un nuevo alumno solicitó unirse a un curso que dictás: "${fields.courseName}"</p>
      <p style="font-weight: bold;">Datos del alumno</p>
      <p>
        Nombre: ${fields.studentFullname}<br />
        Correo: ${fields.studentEmail}
      </p>
    `;

    return getDefaultTemplate(content);
  }
});
