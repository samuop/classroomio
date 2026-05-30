import * as z from 'zod';

import { defineEmail } from '../send';
import { getDefaultTemplate } from '../templates';

export const studentCourseInviteEmail = defineEmail({
  id: 'studentCourseInvite',
  subject: 'Te invitaron a un curso',
  schema: z.object({
    orgName: z.string().min(1),
    courseName: z.string().min(1),
    inviteLink: z.string().url(),
    expiresAt: z.string().min(1)
  }),
  render: (fields) => {
    const content = `
      <p>Hola,</p>
      <p>Te invitaron a sumarte al curso <strong>${fields.courseName}</strong> en ${fields.orgName}.</p>
      <p>Esta invitación vence el <strong>${fields.expiresAt}</strong>.</p>
      <div>
        <a class="button" href="${fields.inviteLink}">Ir al curso</a>
      </div>
    `;

    return getDefaultTemplate(content);
  }
});
