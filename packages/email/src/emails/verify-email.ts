import * as z from 'zod';

import { defineEmail } from '../send';
import { getDefaultTemplate } from '../templates';

export const verifyEmailEmail = defineEmail({
  id: 'verifyEmail',
  subject: 'Acción requerida: confirmá tu correo',
  schema: z.object({
    link: z.url(),
    newEmail: z.email().optional(),
    userName: z.string().optional()
  }),
  render: (fields) => {
    const isEmailChange = !!fields.newEmail;
    const userName = fields.userName || '';

    const content = isEmailChange
      ? `
    <p><strong>Hola ${userName} 👋</strong></p>
    <p>Solicitaste cambiar tu correo a <strong>${fields.newEmail}</strong>.</p>
    <p>Para aprobar el cambio, hacé clic en el botón de abajo:</p>
    <div>
      <a class="button" href="${fields.link}">Aprobar cambio de correo</a>
    </div>
    <p>Si no solicitaste este cambio, ignorá este correo.</p>
  `
      : `
    <p><strong>Hola ${userName} 👋</strong></p>
    <p>Para dejar tu cuenta lista, necesitamos verificar tu correo.</p>
    <p>Hacé clic en el botón <strong>Verificar</strong> de abajo para confirmar tu dirección.</p>
    <div>
      <a class="button" href="${fields.link}">Verificar</a>
    </div>
  `;

    return getDefaultTemplate(content);
  }
});
