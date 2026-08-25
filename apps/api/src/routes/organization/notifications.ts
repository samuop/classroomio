import { Hono } from '@api/utils/hono';
import { ZNotificationSettingsUpdate } from '@cio/utils/validation/notifications';
import { authMiddleware } from '@api/middlewares/auth';
import { handleError } from '@api/utils/errors';
import { orgAdminMiddleware } from '@api/middlewares/org-admin';
import { orgMemberMiddleware } from '@api/middlewares/org-member';
import { zValidator } from '@hono/zod-validator';

import {
  getOrgNotificationSettingsService,
  updateOrgNotificationSettingsService
} from '@api/services/organization/notifications';

/**
 * Qué correos automáticos manda la empresa.
 *
 * GET /organization/notifications — cualquier miembro lee lo resuelto.
 * PUT /organization/notifications — sólo admin; mezcla el parche sobre lo guardado.
 *
 * Lectura abierta a cualquier miembro y escritura sólo para admin, igual que
 * `at-risk`: saber qué avisos están encendidos no es información sensible, y
 * sirve para explicarle a alguien por qué no le llegó un correo.
 */
export const organizationNotificationsRouter = new Hono()
  .get('/', authMiddleware, orgMemberMiddleware, async (c) => {
    try {
      const orgId = c.req.header('cio-org-id')!;
      const settings = await getOrgNotificationSettingsService(orgId);

      return c.json({ success: true as const, data: settings });
    } catch (error) {
      return handleError(c, error, 'Failed to fetch notification settings');
    }
  })
  .put('/', authMiddleware, orgAdminMiddleware, zValidator('json', ZNotificationSettingsUpdate), async (c) => {
    try {
      const orgId = c.req.header('cio-org-id')!;
      const patch = c.req.valid('json');
      const updated = await updateOrgNotificationSettingsService(orgId, patch);

      return c.json({ success: true as const, data: updated });
    } catch (error) {
      return handleError(c, error, 'Failed to update notification settings');
    }
  });
