import {
  EMAIL_BLOCK_KEYS,
  EmailRegistry,
  type EmailBlockKey,
  type EmailBlocks,
  getEditableEmails,
  isEditableEmail,
  renderEmailBlocks,
  sampleFieldsFor
} from '@cio/email';
import {
  deleteOrgEmailTemplate,
  getOrgEmailTemplate,
  getOrgEmailTemplates,
  getRootOrganization,
  upsertOrgEmailTemplate,
  type OrgEmailTemplateRow
} from '@cio/db/queries/organization';
import {
  type TNotificationId,
  type TResolvedNotificationSettings,
  notificationForEmail
} from '@cio/utils/validation/notifications';

import { AppError, ErrorCodes } from '@api/utils/errors';
import {
  getOrgNotificationSettingsService,
  updateOrgNotificationSettingsService
} from '@api/services/organization/notifications';

/**
 * Los textos de los correos se escriben UNA VEZ, en la consultora, y sus
 * empresas cliente los heredan.
 *
 * Misma regla que la firma del remitente, y por el mismo motivo: la alumna de
 * una empresa cliente recibe un correo que dice el nombre de la consultora, así
 * que el texto también es de la consultora. Que cada cliente reescribiera los
 * suyos daría correos que se contradicen entre sí saliendo todos del mismo
 * dominio — y obligaría a la consultora a repetir el mismo trabajo por cliente.
 *
 * El **interruptor** de cada correo, en cambio, es de cada empresa: heredar el
 * texto no es lo mismo que heredar la decisión de mandarlo.
 */

export interface EmailTemplateView {
  id: string;
  /** El texto original: lo que se manda mientras nadie lo cambie. */
  defaults: EmailBlocks;
  /** Lo que se manda hoy — el original con lo reescrito encima. */
  values: EmailBlocks;
  /** Sólo lo reescrito. `null` en un bloque = ése usa el original. */
  overrides: Record<EmailBlockKey, string | null>;
  variables: string[];
  requiredVariables: string[];
  isCustomized: boolean;
  /** El interruptor que lo apaga, o `null` si este correo se manda siempre. */
  notificationId: TNotificationId | null;
  /** Sin interruptor: es parte de un flujo y apagarlo lo rompería. */
  mandatory: boolean;
}

export interface EmailTemplatesPayload {
  templates: EmailTemplateView[];
  /**
   * Los interruptores de la empresa que pregunta, enteros.
   *
   * Van completos y no uno por plantilla porque dos avisos —el de entrega y el
   * de cambio de estado— todavía se arman a mano en el código y no tienen texto
   * editable. Sin esto la pantalla los perdería, que es justo lo que pasaba
   * cuando eran dos pantallas distintas.
   */
  toggles: TResolvedNotificationSettings;
  /** Quién define los textos: la consultora, arriba de todo. */
  textOwner: { id: string; name: string | null };
  /**
   * `false` cuando esta empresa hereda los textos de su consultora. La pantalla
   * los muestra igual —saber qué le va a llegar a tu gente no es secreto— pero
   * en sólo lectura, y dice de quién son.
   */
  canEditText: boolean;
}

/**
 * Restos del diseño anterior, cuando el cuerpo se guardaba como HTML.
 *
 * Esa versión estuvo viva poco tiempo, pero si alguien alcanzó a guardar algo,
 * mostrarlo tal cual sería escupir `<!doctype html>` adentro de un párrafo. Se
 * descarta y el correo vuelve a su texto original, que es el desenlace correcto:
 * el texto de fábrica siempre se puede volver a editar.
 */
function esHtmlViejo(valor: string | null): boolean {
  // Sólo las marcas del documento entero que generaba esa versión. Buscar
  // cualquier `<` seguido de letra descartaría también un texto legítimo —
  // "si el descuento es <b>ajo del 10%"— y borrarlo sin decir nada es peor que
  // el problema que esto resuelve.
  return valor !== null && /<!doctype|<html|<table|<\/p>/i.test(valor);
}

function overridesDe(row: OrgEmailTemplateRow | undefined): Record<EmailBlockKey, string | null> {
  const vacio = Object.fromEntries(EMAIL_BLOCK_KEYS.map((k) => [k, null])) as Record<EmailBlockKey, string | null>;
  if (!row) return vacio;

  return Object.fromEntries(EMAIL_BLOCK_KEYS.map((k) => [k, esHtmlViejo(row[k]) ? null : row[k]])) as Record<
    EmailBlockKey,
    string | null
  >;
}

/** El original con lo reescrito encima, bloque por bloque. */
function resolverBloques(defaults: EmailBlocks, overrides: Record<EmailBlockKey, string | null>): EmailBlocks {
  return Object.fromEntries(EMAIL_BLOCK_KEYS.map((k) => [k, overrides[k] ?? defaults[k]])) as unknown as EmailBlocks;
}

/**
 * De qué empresa salen los textos, y si quien pregunta puede tocarlos.
 *
 * Una empresa sin padre es su propia raíz, así que la consultora se ve a sí
 * misma acá y puede editar; una empresa cliente ve a su consultora y no.
 */
async function resolverDueno(orgId: string): Promise<{ id: string; name: string | null; canEdit: boolean }> {
  const raiz = await getRootOrganization(orgId);
  const id = raiz?.id ?? orgId;

  return { id, name: raiz?.name ?? null, canEdit: id === orgId };
}

/**
 * La guarda que separa a una empresa cliente de los correos de su consultora.
 *
 * `orgAdminMiddleware` sólo prueba que quien pide sea admin **de la empresa del
 * encabezado**. Sin esto, el admin de una empresa cliente escribía en la raíz
 * —porque ahí es donde vive el texto— y le cambiaba los correos a la consultora
 * y a todas sus hermanas, firmados con el nombre de la consultora. El mismo
 * corte que ya hacen Clientes y Espacios de trabajo.
 */
function exigirDueno(dueno: { canEdit: boolean }): void {
  if (dueno.canEdit) return;

  throw new AppError('Email templates are managed from the primary workspace', ErrorCodes.NOT_PRIMARY_WORKSPACE, 403);
}

export async function listEmailTemplatesService(orgId: string): Promise<EmailTemplatesPayload> {
  const dueno = await resolverDueno(orgId);
  const [guardadosRaw, settings] = await Promise.all([
    getOrgEmailTemplates(dueno.id),
    // Los interruptores son de la empresa que pregunta, no de la raíz.
    getOrgNotificationSettingsService(orgId)
  ]);

  const guardados = new Map(guardadosRaw.map((row) => [row.emailId, row]));

  const templates = getEditableEmails().map((email) => {
    const overrides = overridesDe(guardados.get(email.id));
    const aviso = notificationForEmail(email.id);

    return {
      id: email.id,
      defaults: email.defaults,
      values: resolverBloques(email.defaults, overrides),
      overrides,
      variables: email.variables,
      requiredVariables: email.requiredVariables,
      isCustomized: EMAIL_BLOCK_KEYS.some((k) => overrides[k] !== null),
      notificationId: aviso?.id ?? null,
      mandatory: aviso === null
    };
  });

  return { templates, toggles: settings, textOwner: { id: dueno.id, name: dueno.name }, canEditText: dueno.canEdit };
}

export interface EmailTemplatePatch {
  /** Ausente = no tocar ese bloque. `null` = volver al original. */
  blocks?: Partial<Record<EmailBlockKey, string | null>>;
  /** Prender o apagar el envío. Es de la empresa que pide, no de la raíz. */
  enabled?: boolean;
}

export async function updateEmailTemplateService(
  orgId: string,
  emailId: string,
  patch: EmailTemplatePatch,
  updatedByProfileId?: string | null
): Promise<EmailTemplatesPayload> {
  if (!isEditableEmail(emailId)) {
    throw new AppError('That email cannot be customised', ErrorCodes.VALIDATION_ERROR, 400);
  }

  // El permiso se verifica ANTES de tocar nada. Un pedido que trae las dos
  // cosas y falla a la mitad deja el interruptor cambiado y el texto no, que es
  // el peor de los dos desenlaces: la pantalla muestra un estado que nadie pidió.
  const dueno = patch.blocks ? await resolverDueno(orgId) : null;
  if (dueno) exigirDueno(dueno);

  if (patch.enabled !== undefined) {
    const aviso = notificationForEmail(emailId);
    if (!aviso) {
      throw new AppError('That email cannot be turned off', ErrorCodes.VALIDATION_ERROR, 400);
    }

    await updateOrgNotificationSettingsService(orgId, { [aviso.id]: patch.enabled });
  }

  if (patch.blocks && dueno) {
    const bloques = patch.blocks;

    const actual = overridesDe((await getOrgEmailTemplate(dueno.id, emailId)) ?? undefined);
    const proximo = Object.fromEntries(
      EMAIL_BLOCK_KEYS.map((k) => [k, k in bloques ? normalizar(k, bloques[k] ?? null) : actual[k]])
    ) as Record<EmailBlockKey, string | null>;

    if (EMAIL_BLOCK_KEYS.every((k) => proximo[k] === null)) {
      // Vaciar todo es restaurar el original, no guardar seis vacíos.
      await deleteOrgEmailTemplate(dueno.id, emailId);
    } else {
      await upsertOrgEmailTemplate({ orgId: dueno.id, emailId, ...proximo, updatedByProfileId });
    }
  }

  return listEmailTemplatesService(orgId);
}

export async function resetEmailTemplateService(orgId: string, emailId: string): Promise<EmailTemplatesPayload> {
  const dueno = await resolverDueno(orgId);
  exigirDueno(dueno);

  await deleteOrgEmailTemplate(dueno.id, emailId);

  return listEmailTemplatesService(orgId);
}

/**
 * Un bloque en blanco significa "usá el original", no "mandá un asunto vacío".
 *
 * La excepción es el botón: dejarlo sin texto es una elección real —el correo
 * sale sin botón— y hay que poder guardarla. Si se tratara como "usá el
 * original", sacar el botón sería imposible: cada guardado lo devolvería.
 */
const VACIO_ES_ELECCION = new Set<EmailBlockKey>(['ctaLabel']);

function normalizar(clave: EmailBlockKey, valor: string | null): string | null {
  if (valor === null) return null;

  const limpio = valor.trim();
  if (limpio !== '') return valor;

  return VACIO_ES_ELECCION.has(clave) ? '' : null;
}

/** Los bloques con los que se manda de verdad, ya resueltos. */
async function bloquesVigentes(orgId: string | null | undefined, emailId: string): Promise<EmailBlocks | null> {
  const defaults = bloquesDeFabrica(emailId);
  if (!defaults) return null;
  if (!orgId) return defaults;

  const raizId = (await getRootOrganization(orgId))?.id ?? orgId;
  const guardado = await getOrgEmailTemplate(raizId, emailId);

  return resolverBloques(defaults, overridesDe(guardado ?? undefined));
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
    const raizId = (await getRootOrganization(orgId))?.id ?? orgId;
    const guardado = await getOrgEmailTemplate(raizId, emailId);
    const overrides = overridesDe(guardado ?? undefined);

    // Nadie tocó nada: que siga el camino de siempre, sin re-renderizar.
    if (EMAIL_BLOCK_KEYS.every((k) => overrides[k] === null)) return null;

    const defaults = bloquesDeFabrica(emailId);
    if (!defaults) return null;

    const { subject, html } = renderizar(emailId, resolverBloques(defaults, overrides), fields);

    return { subject, content: html };
  } catch (error) {
    console.error(`resolveEmailOverride(${emailId}) falló; se manda el texto de fábrica:`, error);

    return null;
  }
}

function bloquesDeFabrica(emailId: string): EmailBlocks | null {
  return EmailRegistry.get(emailId)?.blocks ?? null;
}

/** Renderiza igual que el envío: mismos bloques, mismas variables calculadas. */
function renderizar(emailId: string, blocks: EmailBlocks, fields: Record<string, unknown>) {
  const template = EmailRegistry.get(emailId)!;
  const completos = template.derived ? { ...fields, ...template.derived(fields) } : fields;
  const sender = typeof fields.orgName === 'string' ? fields.orgName : null;

  return renderEmailBlocks(blocks, completos, { sender });
}

export interface EmailPreview {
  subject: string;
  html: string;
}

/**
 * La vista previa del editor: el correo tal cual va a salir, con datos de mentira.
 *
 * Es lo que reemplaza a editar HTML a ojo. El render es **el mismo** que usa el
 * envío —misma función, mismos bloques, mismas variables calculadas— así que lo
 * que se ve acá no es una aproximación.
 *
 * `draft` son los valores del editor sin guardar: se previsualiza lo que la
 * persona está escribiendo, no lo último que grabó.
 */
export async function previewEmailTemplateService(
  orgId: string,
  emailId: string,
  draft?: Partial<EmailBlocks>
): Promise<EmailPreview> {
  if (!isEditableEmail(emailId)) {
    throw new AppError('That email cannot be customised', ErrorCodes.VALIDATION_ERROR, 400);
  }

  const vigentes = (await bloquesVigentes(orgId, emailId))!;
  const blocks = { ...vigentes, ...limpiarDraft(draft) };
  const template = EmailRegistry.get(emailId)!;

  const fields = sampleFieldsFor(template);
  const dueno = await resolverDueno(orgId);
  // La firma que va a ver el alumno es la de la consultora, no la del cliente:
  // mostrar otra cosa en la vista previa sería mentirle a quien edita.
  if (typeof fields.orgName === 'string' && dueno.name) fields.orgName = dueno.name;

  return renderizar(emailId, blocks, fields);
}

/** Del draft sólo se toman los bloques conocidos, y sólo si son texto. */
function limpiarDraft(draft?: Partial<EmailBlocks>): Partial<EmailBlocks> {
  if (!draft) return {};

  return Object.fromEntries(
    EMAIL_BLOCK_KEYS.filter((k) => typeof draft[k] === 'string').map((k) => [k, draft[k]])
  ) as Partial<EmailBlocks>;
}
