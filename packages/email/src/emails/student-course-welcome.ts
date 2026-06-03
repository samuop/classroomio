import * as z from 'zod';

import { defineEmail } from '../send';
import { getDefaultTemplate } from '../templates';

export const studentCourseWelcomeEmail = defineEmail({
  id: 'studentCourseWelcome',
  subject: 'Ya tenés acceso a un curso — iniciá sesión para comenzar',
  schema: z.object({
    orgName: z.string().min(1),
    courseName: z.string().min(1),
    loginUrl: z.string().min(1)
  }),
  render: (fields) => {
    const content = `
      <p>Hola,</p>
      <p>Ya tenés acceso al curso <strong>${fields.courseName}</strong> en <strong>${fields.orgName}</strong>.</p>
      <p><a href="${fields.loginUrl}">Iniciá sesión</a> para abrir el curso y empezar.</p>
      <p>Si tenés algún inconveniente, escribile a tu instructor.</p>
      <p>Saludos,</p>
      <p>${fields.orgName}</p>
    `;

    return getDefaultTemplate(content);
  }
});
