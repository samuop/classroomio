import * as z from 'zod';

import { defineEmail } from '../send';
import { getDefaultTemplate } from '../templates';

export const teacherCourseWelcomeEmail = defineEmail({
  id: 'teacherCourseWelcome',
  subject: '¡Te invitaron a un curso!',
  schema: z.object({
    name: z.string().min(1),
    orgName: z.string().min(1),
    courseName: z.string().min(1),
    inviteLink: z.url()
  }),
  render: (fields) => {
    const content = `
      <p>Hola ${fields.name},</p>
      <p>${fields.orgName} te dio acceso para dictar un curso.</p>
      <p>El curso se llama: ${fields.courseName}</p>
      <div>
        <a class="button" href="${fields.inviteLink}">Abrir panel</a>
      </div>
    `;

    return getDefaultTemplate(content);
  }
});
