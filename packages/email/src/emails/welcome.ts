import * as z from 'zod';

import { defineEmail } from '../send';
import { getDefaultTemplate } from '../templates';

export const welcomeEmail = defineEmail({
  id: 'welcome',
  subject: '¡Bienvenido/a a la plataforma de capacitación!',
  schema: z.object({
    name: z.string().min(1)
  }),
  render: (fields) => {
    const content = `
    <p>Hola ${fields.name},</p>
    <p>Te damos la bienvenida a la plataforma de capacitación.</p>
    <p>Ya podés iniciar sesión para acceder a tus cursos y programas asignados.</p>
    <p>Ante cualquier duda, respondé este correo y te ayudamos.</p>
    <p>Saludos.</p>
  `;

    return getDefaultTemplate(content);
  }
});
