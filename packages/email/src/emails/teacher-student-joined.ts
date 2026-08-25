import * as z from 'zod';

import { defineEmail } from '../send';

export const teacherStudentJoinedEmail = defineEmail({
  id: 'teacherStudentJoined',
  schema: z.object({
    courseName: z.string().min(1),
    studentName: z.string().min(1),
    studentEmail: z.email()
  }),
  blocks: {
    subject: '¡Tenés un nuevo alumno 🎉!',
    heading: '',
    body: 'Hola,\n\n¡Felicitaciones! 🎉 Un nuevo alumno: *{studentName} ({studentEmail})* se sumó a un curso que dictás: {courseName}\n\nEsperamos que tenga una gran experiencia de aprendizaje.\n\nAnte cualquier inconveniente, escribinos.',
    ctaLabel: '',
    ctaUrl: '',
    footer: ''
  }
});
