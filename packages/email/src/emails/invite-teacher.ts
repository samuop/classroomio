import * as z from 'zod';

import { defineEmail } from '../send';
import { getDefaultTemplate } from '../templates';

export const inviteTeacherEmail = defineEmail({
  id: 'inviteTeacher',
  subject: 'Te invitaron a sumarte como instructor 😃',
  schema: z.object({
    email: z.string().email(),
    orgName: z.string().min(1),
    orgSiteName: z.string().min(1),
    roleName: z.string().min(1),
    expiresAt: z.string().min(1),
    inviteLink: z.url()
  }),
  render: (fields) => {
    const content = `
      <p>Hola,</p>
      <p>Te invitaron a unirte a ${fields.orgName} como ${fields.roleName} 🎉🎉🎉.</p>
      <p>Esta invitación vence el ${fields.expiresAt} (UTC).</p>
      <div>
        <a class="button" href="${fields.inviteLink}">Aceptar invitación</a>
      </div>
    `;

    return getDefaultTemplate(content);
  }
});
