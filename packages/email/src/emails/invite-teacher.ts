import * as z from 'zod';

import { defineEmail } from '../send';

export const inviteTeacherEmail = defineEmail({
  id: 'inviteTeacher',
  schema: z.object({
    email: z.string().email(),
    orgName: z.string().min(1),
    orgSiteName: z.string().min(1),
    roleName: z.string().min(1),
    expiresAt: z.string().min(1),
    inviteLink: z.url()
  }),
  blocks: {
    subject: 'Te invitaron a sumarte como instructor 😃',
    heading: '',
    body: 'Hola,\n\nTe invitaron a unirte a {orgName} como {roleName} 🎉🎉🎉.\n\nEsta invitación vence el {expiresAt} (UTC).',
    ctaLabel: 'Aceptar invitación',
    ctaUrl: '{inviteLink}',
    footer: ''
  }
});
