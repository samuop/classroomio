import { enqueueEmailSend, isRedisConfigured } from '@cio/jobs';
import { EmailRegistry, buildEmailFromName, type EmailId, type EmailSchemaFor } from '@cio/email';
import * as z from 'zod';

import { logRedisUnavailableOnce } from '@api/utils/redis/redis';
import { resolveEmailOverride } from '@api/services/organization/email-template';
import { resolveSenderName } from '@api/services/organization/sender-name';

type Recipient = string | string[];

interface CommonOptions {
  /**
   * Stable key used as BullMQ `jobId` for idempotent enqueue (e.g.
   * `welcome:<userId>`). When omitted the job gets an auto-generated id, so
   * duplicate calls produce duplicate emails.
   */
  idempotencyKey?: string;
}

export interface EnqueueTemplateEmailInput<TId extends EmailId> extends CommonOptions {
  to: Recipient;
  fields: z.infer<EmailSchemaFor<TId>>;
  from?: string;
  replyTo?: string;
  /**
   * De qué empresa sale el correo. Sirve para buscar el texto que esa empresa
   * (o su consultora) haya reescrito. Sin esto sale el de fábrica.
   */
  orgId?: string | null;
}

export interface EnqueueRawEmailInput extends CommonOptions {
  to: Recipient;
  subject: string;
  content: string;
  from?: string;
  replyTo?: string;
}

export interface EnqueueResult {
  /** BullMQ job ids — one per recipient. */
  jobIds: string[];
}

function toRecipientArray(to: Recipient): string[] {
  return Array.isArray(to) ? to : [to];
}

function recipientKey(base: string | undefined, recipient: string, total: number): string | undefined {
  if (!base) return undefined;

  return total === 1 ? base : `${base}:${recipient}`;
}

/**
 * Fire-and-forget enqueue of a registered template email. Validates `fields`
 * against the template's Zod schema up front so bad payloads fail in the
 * domain handler instead of silently inside the worker.
 *
 * BullMQ tracks send state, retries, and failure history — no DB ledger is
 * written. Final failures are recorded in `dead_letter_job` by the worker
 * for operator triage.
 */
export async function enqueueTransactionalEmail<TId extends EmailId>(
  template: TId,
  input: EnqueueTemplateEmailInput<TId>
): Promise<EnqueueResult> {
  const definition = EmailRegistry.get(template);
  if (!definition) {
    throw new Error(`Email template "${template}" is not registered`);
  }

  const validatedFields = definition.schema.parse(input.fields) as Record<string, unknown>;

  if (!isRedisConfigured()) {
    logRedisUnavailableOnce('Redis not configured: emails not enqueued. Set REDIS_URL and run apps/jobs to send them.');
    return { jobIds: [] };
  }

  const recipients = toRecipientArray(input.to);
  const jobIds: string[] = [];

  // El texto reescrito se resuelve UNA vez, acá, y no en cada punto de envío:
  // los catorce correos pasan por esta función, así que es el único lugar donde
  // no se puede olvidar. Si la empresa no tocó nada, `override` es null y todo
  // sigue exactamente como antes.
  const override = await resolveEmailOverride(input.orgId, template, validatedFields);

  /**
   * Con qué nombre se firma, por el mismo motivo que el texto: acá y no en cada
   * punto de envío.
   *
   * `resolveSenderName` existía y funcionaba, pero había que acordarse de
   * llamarlo en cada sitio — y en tres no se llamó (`inviteTeacher`,
   * `programGoalReminder`, `welcome`). Sin `from`, el envío cae a `SMTP_SENDER`,
   * que es el nombre del DESPLIEGUE: una invitación de una empresa cliente salía
   * firmada con la marca de la plataforma en vez de con la de su consultora.
   *
   * Se respeta el `from` que venga armado: quien ya lo resolvió sabe más que
   * esta función.
   */
  const from = input.from ?? (input.orgId ? buildEmailFromName(await resolveSenderName(input.orgId)) : undefined);

  for (const recipient of recipients) {
    const jobId = await enqueueEmailSend(
      override
        ? {
            // Ya renderizado: el worker no necesita saber nada de esto.
            kind: 'raw',
            to: recipient,
            subject: override.subject,
            content: override.content,
            from,
            replyTo: input.replyTo
          }
        : {
            kind: 'template',
            template,
            to: recipient,
            fields: validatedFields,
            from,
            replyTo: input.replyTo
          },
      { idempotencyKey: recipientKey(input.idempotencyKey, recipient, recipients.length) }
    );

    if (jobId) jobIds.push(jobId);
  }

  return { jobIds };
}

/**
 * Fire-and-forget enqueue of a free-form subject/content email — used by the
 * public mail route and submission notifications that don't have a registered
 * template.
 */
export async function enqueueRawEmail(input: EnqueueRawEmailInput): Promise<EnqueueResult> {
  if (!isRedisConfigured()) {
    logRedisUnavailableOnce('Redis not configured: emails not enqueued. Set REDIS_URL and run apps/jobs to send them.');
    return { jobIds: [] };
  }

  const recipients = toRecipientArray(input.to);
  const jobIds: string[] = [];

  for (const recipient of recipients) {
    const jobId = await enqueueEmailSend(
      {
        kind: 'raw',
        to: recipient,
        subject: input.subject,
        content: input.content,
        from: input.from,
        replyTo: input.replyTo
      },
      { idempotencyKey: recipientKey(input.idempotencyKey, recipient, recipients.length) }
    );

    if (jobId) jobIds.push(jobId);
  }

  return { jobIds };
}
