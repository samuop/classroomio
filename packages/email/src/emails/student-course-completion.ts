import * as z from 'zod';

import { defineEmail } from '../send';
import { getDefaultTemplate } from '../templates';

export const studentCourseCompletionEmail = defineEmail({
  id: 'studentCourseCompletion',
  subject: '¡Felicitaciones! Completaste el curso',
  schema: z.object({
    orgName: z.string().min(1),
    courseName: z.string().min(1),
    studentName: z.string().min(1),
    certificateUrl: z.string().url(),
    customMessage: z.string().nullable().optional()
  }),
  render: (fields) => {
    const customBlock =
      fields.customMessage && fields.customMessage.trim().length > 0
        ? `<div style="margin:16px 0;padding:12px;border-left:3px solid #6366f1;background:#f8fafc;">${fields.customMessage}</div>`
        : '';

    const content = `
      <p>Hola ${fields.studentName},</p>
      <p>¡Felicitaciones! Cumpliste con los requisitos del curso <strong>${fields.courseName}</strong>.</p>
      ${customBlock}
      <p><a href="${fields.certificateUrl}" style="display:inline-block;padding:10px 16px;background:#111827;color:#fff;text-decoration:none;border-radius:6px;">Ver tu certificado</a></p>
      <p>Si el botón no funciona, copiá y pegá este enlace en tu navegador:<br/><span style="word-break:break-all;">${fields.certificateUrl}</span></p>
      <p>Saludos,<br/>${fields.orgName}</p>
    `;

    return getDefaultTemplate(content);
  }
});
