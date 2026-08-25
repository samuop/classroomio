import * as z from 'zod';

import { defineEmail } from '../send';

export const teacherStudentBuyRequestEmail = defineEmail({
  id: 'teacherStudentBuyRequest',
  schema: z.object({
    courseName: z.string().min(1),
    studentEmail: z.string().email(),
    studentFullname: z.string().min(1)
  }),
  blocks: {
    subject: '¡Solicitud para unirse a un curso!',
    heading: '',
    body: 'Hola,\n\nUn nuevo alumno solicitó unirse a un curso que dictás: "{courseName}"\n\n*Datos del alumno*\nNombre: {studentFullname}\nCorreo: {studentEmail}',
    ctaLabel: '',
    ctaUrl: '',
    footer: ''
  }
});
