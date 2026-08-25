import * as z from 'zod';

import { EMAIL_BLOCK_KEYS, EMAIL_BLOCK_LIMITS, type EmailBlockKey } from '@cio/email';
import { Hono } from '@api/utils/hono';
import { authMiddleware } from '@api/middlewares/auth';
import { handleError } from '@api/utils/errors';
import { orgAdminMiddleware } from '@api/middlewares/org-admin';
import { zValidator } from '@hono/zod-validator';

import {
  listEmailTemplatesService,
  previewEmailTemplateService,
  resetEmailTemplateService,
  updateEmailTemplateService
} from '@api/services/organization/email-template';
import { sendTestEmailTemplateService } from '@api/services/organization/email-template-test';

/**
 * Los correos automáticos: qué dicen y cuáles se mandan.
 *
 * Las dos cosas viven en la misma pantalla porque son la misma pregunta —"¿qué
 * le llega a mi gente?"— y estaban separadas en dos lugares que no se
 * mencionaban entre sí.
 *
 * `GET /`                    — el catálogo entero con lo reescrito y los interruptores.
 * `PUT /:emailId`            — guarda bloques y/o prende y apaga el envío.
 * `DELETE /:emailId`         — restaura el texto original.
 * `POST /:emailId/preview`   — el correo renderizado con datos de ejemplo.
 * `POST /:emailId/test`      — se lo manda a alguien para verlo en la bandeja.
 *
 * Todas piden **admin**, incluida la lectura: el contenido es de la empresa y no
 * aporta nada que lo vea un alumno.
 */
const ZEmailIdParam = z.object({ emailId: z.string().min(1).max(64) });

/** Un bloque por clave, con el tope que declara el propio modelo. */
const ZBlocks = z.object(
  Object.fromEntries(
    EMAIL_BLOCK_KEYS.map((clave) => [clave, z.string().max(EMAIL_BLOCK_LIMITS[clave]).nullable().optional()])
  ) as Record<EmailBlockKey, z.ZodOptional<z.ZodNullable<z.ZodString>>>
);

const ZEmailTemplateUpdate = z.object({
  // Ausente = no tocar ese bloque; `null` = volver al original.
  blocks: ZBlocks.optional(),
  enabled: z.boolean().optional()
});

/** Lo que la persona está escribiendo, todavía sin guardar. */
const ZDraft = z.object({
  draft: z
    .object(
      Object.fromEntries(
        EMAIL_BLOCK_KEYS.map((clave) => [clave, z.string().max(EMAIL_BLOCK_LIMITS[clave]).optional()])
      ) as Record<EmailBlockKey, z.ZodOptional<z.ZodString>>
    )
    .optional()
});

const ZTest = ZDraft.extend({ email: z.email() });

export const organizationEmailTemplatesRouter = new Hono()
  .get('/', authMiddleware, orgAdminMiddleware, async (c) => {
    try {
      const orgId = c.req.header('cio-org-id')!;
      const payload = await listEmailTemplatesService(orgId);

      return c.json({ success: true as const, data: payload });
    } catch (error) {
      return handleError(c, error, 'Failed to fetch email templates');
    }
  })
  .put(
    '/:emailId',
    authMiddleware,
    orgAdminMiddleware,
    zValidator('param', ZEmailIdParam),
    zValidator('json', ZEmailTemplateUpdate),
    async (c) => {
      try {
        const orgId = c.req.header('cio-org-id')!;
        const { emailId } = c.req.valid('param');
        const patch = c.req.valid('json');
        const user = c.get('user');

        const payload = await updateEmailTemplateService(orgId, emailId, patch, user?.id ?? null);

        return c.json({ success: true as const, data: payload });
      } catch (error) {
        return handleError(c, error, 'Failed to update email template');
      }
    }
  )
  .delete('/:emailId', authMiddleware, orgAdminMiddleware, zValidator('param', ZEmailIdParam), async (c) => {
    try {
      const orgId = c.req.header('cio-org-id')!;
      const { emailId } = c.req.valid('param');
      const payload = await resetEmailTemplateService(orgId, emailId);

      return c.json({ success: true as const, data: payload });
    } catch (error) {
      return handleError(c, error, 'Failed to reset email template');
    }
  })
  .post(
    '/:emailId/preview',
    authMiddleware,
    orgAdminMiddleware,
    zValidator('param', ZEmailIdParam),
    zValidator('json', ZDraft),
    async (c) => {
      try {
        const orgId = c.req.header('cio-org-id')!;
        const { emailId } = c.req.valid('param');
        const { draft } = c.req.valid('json');

        const preview = await previewEmailTemplateService(orgId, emailId, draft);

        return c.json({ success: true as const, data: preview });
      } catch (error) {
        return handleError(c, error, 'Failed to render email preview');
      }
    }
  )
  .post(
    '/:emailId/test',
    authMiddleware,
    orgAdminMiddleware,
    zValidator('param', ZEmailIdParam),
    zValidator('json', ZTest),
    async (c) => {
      try {
        const orgId = c.req.header('cio-org-id')!;
        const { emailId } = c.req.valid('param');
        const { email, draft } = c.req.valid('json');

        await sendTestEmailTemplateService(orgId, emailId, email, draft);

        return c.json({ success: true as const, data: { sent: true as const } });
      } catch (error) {
        return handleError(c, error, 'Failed to send test email');
      }
    }
  );
