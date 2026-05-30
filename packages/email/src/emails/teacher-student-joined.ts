import * as z from 'zod';

import { defineEmail } from '../send';
import { getDefaultTemplate } from '../templates';

export const teacherStudentJoinedEmail = defineEmail({
  id: 'teacherStudentJoined',
  subject: '¡Tenés un nuevo alumno 🎉!',
  schema: z.object({
    courseName: z.string().min(1),
    studentName: z.string().min(1),
    studentEmail: z.email()
  }),
  render: (fields) => {
    const content = `
      <p>Hola,</p>
      <p>¡Felicitaciones! 🎉 Un nuevo alumno: <strong>${fields.studentName} (${fields.studentEmail})</strong> se sumó a un curso que dictás: ${fields.courseName}</p>
      <p>Esperamos que tenga una gran experiencia de aprendizaje.</p>
      <p>Ante cualquier inconveniente, escribinos.</p>
    `;

    return getDefaultTemplate(content);
  }
});
