import { type EmailBlocks } from '@cio/email';
import { buildEmailFromName } from '@cio/email';

import { enqueueRawEmail } from '@api/services/jobs/email-jobs';
import { previewEmailTemplateService } from '@api/services/organization/email-template';
import { resolveSenderName } from '@api/services/organization/sender-name';

/**
 * Mandarse el correo a uno mismo para verlo en la bandeja de entrada.
 *
 * La vista previa muestra el HTML, pero no muestra lo que hace Gmail con él —y
 * eso es la mitad del problema en correos: un botón que en el navegador se ve
 * perfecto puede llegar como un link celeste. Esto cierra ese hueco.
 *
 * Vive en su propio archivo y no junto al resto del servicio por una razón
 * mecánica: `email-jobs` importa `resolveEmailOverride` de ahí, así que meter la
 * importación al revés cerraría el círculo.
 *
 * Manda **el borrador**, no lo guardado: el sentido es probar antes de grabar.
 */
export async function sendTestEmailTemplateService(
  orgId: string,
  emailId: string,
  to: string,
  draft?: Partial<EmailBlocks>
): Promise<void> {
  const { subject, html } = await previewEmailTemplateService(orgId, emailId, draft);

  await enqueueRawEmail({
    to,
    // Marcado como prueba en el asunto: si llega a la bandeja equivocada, que se
    // note de entrada que no es un correo real del sistema.
    subject: `[Prueba] ${subject}`,
    content: html,
    from: buildEmailFromName(await resolveSenderName(orgId))
  });
}
