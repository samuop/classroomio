import { Hono } from '@api/utils/hono';
import { authMiddleware } from '@api/middlewares/auth';
import { orgMemberMiddleware } from '@api/middlewares/org-member';
import { orgAdminMiddleware } from '@api/middlewares/org-admin';
import { handleError } from '@api/utils/errors';
import { zValidator } from '@hono/zod-validator';
import { ZAiImagePreview, ZAiImageSettingsUpdate } from '@cio/utils/validation';

import {
  getOrgAiImageSettingsService,
  updateOrgAiImageSettingsService
} from '@api/services/organization/ai-images';
import { generateStylePreview } from '@api/services/agent/image-generation';

/**
 * Org-level look for generated lesson images.
 *
 * GET  /organization/ai-images          — any org member can read the resolved settings.
 * PUT  /organization/ai-images          — org admin only; merges the patch.
 * POST /organization/ai-images/preview  — org admin only; generates ONE image so the
 *                                          admin can see the style before every lesson
 *                                          in a course inherits it. Costs real money,
 *                                          which is why it is a deliberate button and
 *                                          not a live preview.
 */
export const organizationAiImagesRouter = new Hono()
  .get('/', authMiddleware, orgMemberMiddleware, async (c) => {
    try {
      const orgId = c.req.header('cio-org-id')!;
      const settings = await getOrgAiImageSettingsService(orgId);

      return c.json({ success: true as const, data: settings });
    } catch (error) {
      return handleError(c, error, 'Failed to fetch image style settings');
    }
  })
  .put('/', authMiddleware, orgAdminMiddleware, zValidator('json', ZAiImageSettingsUpdate), async (c) => {
    try {
      const orgId = c.req.header('cio-org-id')!;
      const updated = await updateOrgAiImageSettingsService(orgId, c.req.valid('json'));

      return c.json({ success: true as const, data: updated });
    } catch (error) {
      return handleError(c, error, 'Failed to update image style settings');
    }
  })
  .post('/preview', authMiddleware, orgAdminMiddleware, zValidator('json', ZAiImagePreview), async (c) => {
    try {
      const orgId = c.req.header('cio-org-id')!;
      const body = c.req.valid('json');

      // Previews the UNSAVED form, so what the admin is looking at is what the
      // button next to it would store — falling back to what is already saved
      // for anything the form did not send.
      const saved = await getOrgAiImageSettingsService(orgId);
      const image = await generateStylePreview({
        orgId,
        styleNote: body.styleNote ?? saved.styleNote,
        styleReferenceUrl:
          body.styleReferenceUrl === undefined ? saved.styleReferenceUrl : body.styleReferenceUrl
      });

      return c.json({ success: true as const, data: image });
    } catch (error) {
      return handleError(c, error, 'Failed to generate a style preview');
    }
  });
