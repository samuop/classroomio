import * as z from 'zod';

import { defineEmail } from '../send';
import { getDefaultTemplate } from '../templates';

export const forgotPasswordEmail = defineEmail({
  id: 'forgotPassword',
  subject: 'Restablecer tu contraseña',
  schema: z.object({
    email: z.email(),
    name: z.string().min(1),
    link: z.url()
  }),
  render: (fields) => {
    const content = `Hola ${fields.name},
    <p>Recibís este correo porque se solicitó restablecer la contraseña de tu cuenta.</p>
    <p>Hacé clic en el botón de abajo para crear una nueva contraseña:</p>

    <div>
      <a class="button" href="${fields.link}">Restablecer mi contraseña</a>
    </div>

    <p>PD: Si no solicitaste este cambio, respondé este correo para que podamos revisar un posible intento de acceso a tu cuenta.</p>
    `;

    return getDefaultTemplate(content);
  }
});
