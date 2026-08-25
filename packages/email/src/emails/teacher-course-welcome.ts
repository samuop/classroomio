import * as z from 'zod';

import { defineEmail } from '../send';

export const teacherCourseWelcomeEmail = defineEmail({
  id: 'teacherCourseWelcome',
  schema: z.object({
    name: z.string().min(1),
    orgName: z.string().min(1),
    courseName: z.string().min(1),
    inviteLink: z.url()
  }),
  blocks: {
    subject: '¡Te invitaron a un curso!',
    heading: '',
    body: 'Hola {name},\n\n{orgName} te dio acceso para dictar un curso.\n\nEl curso se llama: *{courseName}*',
    ctaLabel: 'Abrir panel',
    ctaUrl: '{inviteLink}',
    footer: ''
  }
});
