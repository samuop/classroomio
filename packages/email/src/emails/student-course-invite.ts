import * as z from 'zod';

import { defineEmail } from '../send';

export const studentCourseInviteEmail = defineEmail({
  id: 'studentCourseInvite',
  schema: z.object({
    orgName: z.string().min(1),
    courseName: z.string().min(1),
    inviteLink: z.string().url(),
    expiresAt: z.string().min(1)
  }),
  blocks: {
    subject: 'Te invitaron a un curso',
    heading: '',
    body: 'Hola,\n\nTe invitaron a sumarte al curso *{courseName}* en {orgName}.\n\nEsta invitación vence el *{expiresAt}*.',
    ctaLabel: 'Ir al curso',
    ctaUrl: '{inviteLink}',
    footer: ''
  }
});
