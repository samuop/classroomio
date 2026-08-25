import {
  deleteOrgEmailTemplate,
  getOrgEmailTemplate,
  getOrgEmailTemplates,
  getRootOrganizationId,
  upsertOrgEmailTemplate
} from '@cio/db/queries/organization';
import { EmailRegistry, applyVariables, getEditableEmails, isEditableEmail } from '@cio/email';

import { AppError } from '@api/utils/errors';
import { sanitizeEmailBody } from '@api/utils/sanitize-email-body';

/**
 * Los textos de los correos se escriben UNA VEZ, en la consultora, y sus
 * empresas cliente los heredan.
 *
 * Misma regla que la firma del remitente, y por el mismo motivo: la alumna de
 * una empresa cliente recibe un correo que dice el nombre de la consultora, así
 * que el texto también es de la consultora. Que cada cliente reescribiera los
 * suyos daría correos que se contradicen entre sí saliendo todos del mismo
 * dominio — y obligaría a la consultora a repetir el mismo trabajo por cliente.
 */

/** Lo que la pantalla necesita para dibujarse: el catálogo con lo reescrito encima. */
export interface EmailTemplateView {
  id: string;
  defaultSubject: string;
  defaultBody: string;
  variables: string[];
  requiredVariables: string[];
  /** `null` cuando nadie lo tocó: la pantalla muestra el de fábrica. */
  subject: string | null;
  body: string | null;
  isCustomized: boolean;
}

/**
 * El cuerpo de fábrica, para mostrarlo como punto de partida en el editor.
 *
 * Se obtiene renderizando la plantilla con las variables SIN reemplazar —
 * `{courseName}` en vez de un curso concreto— así lo que ve el admin es
 * exactamente lo que puede editar, marcadores incluidos.
 */
function cuerpoDeFabrica(emailId: string): string {
  const template = EmailRegistry.get(emailId);
  if (!template) return '';

  const shape = (template.schema as unknown as { shape?: Record<string, unknown> }).shape ?? {};
  const marcadores = Object.fromEntries(Object.keys(shape).map((clave) => [clave, `{${clave}}`]));

  try {
    return template.render(marcadores);
  } catch (error) {
    // Una plantilla que no aguanta valores de mentira no puede previsualizarse,
    // pero eso no puede tumbar la pantalla entera.
    console.error(`No se pudo renderizar el cuerpo de fábrica de "${emailId}":`, error);

    return '';
  }
}

export async function listEmailTemplatesService(orgId: string): Promise<EmailTemplateView[]> {
  const raiz = (await getRootOrganizationId(orgId)) ?? orgId;
  const guardados = new Map((await getOrgEmailTemplates(raiz)).map((row) => [row.emailId, row]));

  return getEditableEmails().map((email) => {
    const guardado = guardados.get(email.id);

    return {
      id: email.id,
      defaultSubject: email.defaultSubject,
      defaultBody: cuerpoDeFabrica(email.id),
      variables: email.variables,
      requiredVariables: email.requiredVariables,
      subject: guardado?.subject ?? null,
      body: guardado?.body ?? null,
      isCustomized: Boolean(guardado && (guardado.subject !== null || guardado.body !== null))
    };
  });
}

export async function updateEmailTemplateService(
  orgId: string,
  emailId: string,
  patch: { subject?: string | null; body?: string | null },
  updatedByProfileId?: string | null
): Promise<EmailTemplateView[]> {
  if (!isEditableEmail(emailId)) {
    throw new AppError('That email cannot be customised', 'VALIDATION_ERROR', 400);
  }

  const raiz = (await getRootOrganizationId(orgId)) ?? orgId;
  const actual = await getOrgEmailTemplate(raiz, emailId);

  const subject = patch.subject === undefined ? (actual?.subject ?? null) : normalizar(patch.subject);
  // El cuerpo se sanea ANTES de guardar, no al enviar: así lo guardado ya es
  // seguro y un envío nunca depende de que alguien se acuerde de limpiarlo.
  const body = patch.body === undefined ? (actual?.body ?? null) : normalizar(patch.body, sanitizeEmailBody);

  if (subject === null && body === null) {
    // Vaciar los dos campos es restaurar el original, no guardar dos vacíos.
    await deleteOrgEmailTemplate(raiz, emailId);
  } else {
    await upsertOrgEmailTemplate({ orgId: raiz, emailId, subject, body, updatedByProfileId });
  }

  return listEmailTemplatesService(orgId);
}

export async function resetEmailTemplateService(orgId: string, emailId: string): Promise<EmailTemplateView[]> {
  const raiz = (await getRootOrganizationId(orgId)) ?? orgId;
  await deleteOrgEmailTemplate(raiz, emailId);

  return listEmailTemplatesService(orgId);
}

function normalizar(valor: string | null, transformar?: (v: string) => string): string | null {
  if (valor === null) return null;

  const limpio = transformar ? transformar(valor) : valor;

  // Un campo en blanco significa "usá el de fábrica", no "mandá un asunto vacío".
  return limpio.trim() === '' ? null : limpio;
}

/**
 * Lo que se manda de verdad: el texto reescrito con las variables aplicadas, o
 * `null` si esta empresa no tocó nada y hay que usar la plantilla de fábrica.
 *
 * Devuelve `null` en vez de tirar cuando algo falla. Corre dentro del envío de
 * un correo: quedarse sin texto reescrito significa mandar el de fábrica, que es
 * un desenlace perfectamente aceptable. No mandar nada, no.
 */
export async function resolveEmailOverride(
  orgId: string | null | undefined,
  emailId: string,
  fields: Record<string, unknown>
): Promise<{ subject: string; content: string } | null> {
  if (!orgId || !isEditableEmail(emailId)) return null;

  try {
    const raiz = (await getRootOrganizationId(orgId)) ?? orgId;
    const guardado = await getOrgEmailTemplate(raiz, emailId);

    if (!guardado || (guardado.subject === null && guardado.body === null)) return null;

    const template = EmailRegistry.get(emailId);
    if (!template) return null;

    const subject = guardado.subject
      ? applyVariables(guardado.subject, fields, 'texto')
      : applyVariables(template.subject, fields, 'texto');

    const content = guardado.body ? applyVariables(guardado.body, fields, 'html') : template.render(fields);

    return { subject, content };
  } catch (error) {
    console.error(`resolveEmailOverride(${emailId}) falló; se manda el texto de fábrica:`, error);

    return null;
  }
}
