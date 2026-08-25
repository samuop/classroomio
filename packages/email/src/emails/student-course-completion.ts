import * as z from 'zod';

import { defineEmail } from '../send';

export const studentCourseCompletionEmail = defineEmail({
  id: 'studentCourseCompletion',
  schema: z.object({
    orgName: z.string().min(1),
    courseName: z.string().min(1),
    studentName: z.string().min(1),
    certificateUrl: z.string().url(),
    customMessage: z.string().nullable().optional()
  }),
  // El mensaje del docente es opcional: si no lo escribió, el párrafo desaparece
  // en vez de dejar un hueco.
  derived: (fields) => ({
    customMessage: fields.customMessage?.trim() ?? ''
  }),
  blocks: {
    subject: '¡Felicitaciones! Completaste el curso',
    heading: '',
    body: 'Hola {studentName},\n\n¡Felicitaciones! Cumpliste con los requisitos del curso *{courseName}*.\n\n{customMessage}\n\nSaludos,\n{orgName}',
    ctaLabel: 'Ver tu certificado',
    ctaUrl: '{certificateUrl}',
    footer: 'Si el botón no funciona, copiá y pegá este enlace en tu navegador:\n{certificateUrl}'
  }
});
