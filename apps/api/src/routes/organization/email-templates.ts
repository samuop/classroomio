import * as z from 'zod';

import { Hono } from '@api/utils/hono';
import { authMiddleware } from '@api/middlewares/auth';
import { handleError } from '@api/utils/errors';
import { orgAdminMiddleware } from '@api/middlewares/org-admin';
import { zValidator } from '@hono/zod-validator';

import {
  listEmailTemplatesService,
  resetEmailTemplateService,
  updateEmailTemplateService
} from '@api/services/organization/email-template';

/**
 * El texto de los correos automáticos.
 *
 * Las tres rutas piden **admin**, incluida la lectura: a diferencia de los
 * interruptores de avisos, acá el contenido es de la empresa y no aporta nada
 * que lo vea un alumno.
 *
 * `PUT /:emailId`     — guarda asunto y/o cuerpo. Un campo vacío vuelve al de fábrica.
 * `DELETE /:emailId`  — restaura el original.
 */
const ZEmailIdParam = z.object({ emailId: z.string().min(1).max(64) });

const ZEmailTemplateUpdate = z.object({
  // `null` es "volvé al de fábrica"; ausente es "no toques este campo".
  subject: z.string().max(200).nullable().optional(),
  body: z.string().max(20000).nullable().optional()
});

export const organizationEmailTemplatesRouter = new Hono()
  .get('/', authMiddleware, orgAdminMiddleware, async (c) => {
    try {
      const orgId = c.req.header('cio-org-id')!;
      const templates = await listEmailTemplatesService(orgId);

      return c.json({ success: true as const, data: templates });
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

        const templates = await updateEmailTemplateService(orgId, emailId, patch, user?.id ?? null);

        return c.json({ success: true as const, data: templates });
      } catch (error) {
        return handleError(c, error, 'Failed to update email template');
      }
    }
  )
  .delete('/:emailId', authMiddleware, orgAdminMiddleware, zValidator('param', ZEmailIdParam), async (c) => {
    try {
      const orgId = c.req.header('cio-org-id')!;
      const { emailId } = c.req.valid('param');
      const templates = await resetEmailTemplateService(orgId, emailId);

      return c.json({ success: true as const, data: templates });
    } catch (error) {
      return handleError(c, error, 'Failed to reset email template');
    }
  });
