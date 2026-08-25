import * as z from 'zod';

import { defineEmail } from '../send';

export const studentOrgInviteEmail = defineEmail({
  id: 'studentOrgInvite',
  schema: z.object({
    email: z.string().email(),
    orgName: z.string().min(1),
    inviteLink: z.url(),
    expiresAt: z.string().min(1),
    courseNames: z.string().optional()
  }),
  // Cuando no hay cursos, `courseLine` queda vacía y el párrafo se cae solo.
  derived: (fields) => ({
    courseLine: fields.courseNames ? `Se te dio acceso a: ${fields.courseNames}.` : ''
  }),
  blocks: {
    subject: 'Te invitaron a la plataforma de capacitación',
    heading: '',
    body: 'Hola,\n\nTe invitaron a unirte a *{orgName}* como alumno.\n\n{courseLine}\n\nEsta invitación vence el {expiresAt} (UTC).',
    ctaLabel: 'Aceptar invitación',
    ctaUrl: '{inviteLink}',
    footer: ''
  }
});
