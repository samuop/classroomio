import * as z from 'zod';

import { defineEmail } from '../send';
import { getDefaultTemplate } from '../templates';

export const studentOrgInviteEmail = defineEmail({
  id: 'studentOrgInvite',
  subject: 'Te invitaron a la plataforma de capacitación',
  schema: z.object({
    email: z.string().email(),
    orgName: z.string().min(1),
    inviteLink: z.url(),
    expiresAt: z.string().min(1),
    courseNames: z.string().optional()
  }),
  render: (fields) => {
    const courseLine = fields.courseNames
      ? `<p>Se te dio acceso a: <strong>${fields.courseNames}</strong>.</p>`
      : '';

    const content = `
      <p>Hola,</p>
      <p>Te invitaron a unirte a <strong>${fields.orgName}</strong> como alumno.</p>
      ${courseLine}
      <p>Esta invitación vence el ${fields.expiresAt} (UTC).</p>
      <div>
        <a class="button" href="${fields.inviteLink}">Aceptar invitación</a>
      </div>
    `;

    return getDefaultTemplate(content);
  }
});
