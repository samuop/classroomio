import * as z from 'zod';

import { defineEmail } from '../send';
import { getDefaultTemplate } from '../templates';

export const onPasswordResetEmail = defineEmail({
  id: 'onPasswordReset',
  subject: 'Tu contraseña fue restablecida',
  schema: z.object({
    name: z.string().min(1)
  }),
  render: (fields) => {
    return getDefaultTemplate(`Hola ${fields.name},
    <p>Tu contraseña se restableció correctamente.</p>
    `);
  }
});
