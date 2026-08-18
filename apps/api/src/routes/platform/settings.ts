import { ZPlatformSettingsUpdate } from '@cio/utils/validation/platform';
import { setPlatformSetting } from '@cio/db/queries/platform';
import { zValidator } from '@hono/zod-validator';

import { Hono } from '@api/utils/hono';
import { authMiddleware } from '@api/middlewares/auth';
import { platformAdminMiddleware } from '@api/middlewares/platform-admin';
import { AppError, ErrorCodes, handleError } from '@api/utils/errors';
import {
  PLATFORM_SETTING_KEYS,
  getGlobalChatModel,
  invalidateSettingsCache,
  isSelectableChatModel,
  listSelectableChatModels
} from '@api/services/platform/settings';

/**
 * Deployment settings for the platform owner.
 *
 * GET returns the current chat model together with the models that may be
 * chosen, so the panel never has to keep its own copy of that list — that list
 * is Google's answer about this key, and a second copy would be a stale one.
 */
export const platformSettingsRouter = new Hono()
  .get('/', authMiddleware, platformAdminMiddleware, async (c) => {
    try {
      const [chatModel, selectableChatModels] = await Promise.all([getGlobalChatModel(), listSelectableChatModels()]);

      return c.json({ success: true as const, data: { chatModel, selectableChatModels } });
    } catch (error) {
      return handleError(c, error, 'Failed to load platform settings');
    }
  })
  .put('/', authMiddleware, platformAdminMiddleware, zValidator('json', ZPlatformSettingsUpdate), async (c) => {
    try {
      const { chatModel } = c.req.valid('json');

      if (chatModel !== null && !(await isSelectableChatModel(chatModel))) {
        throw new AppError(`Unsupported chat model: ${chatModel}`, ErrorCodes.VALIDATION_ERROR, 400);
      }

      // Cleared settings are stored as an empty object rather than deleting the
      // row, so who cleared it and when survives — a delete throws that away.
      await setPlatformSetting(
        PLATFORM_SETTING_KEYS.chatModel,
        chatModel === null ? {} : { model: chatModel },
        c.get('user')?.id
      );
      invalidateSettingsCache();

      return c.json({ success: true as const, data: { chatModel } });
    } catch (error) {
      return handleError(c, error, 'Failed to update platform settings');
    }
  });
