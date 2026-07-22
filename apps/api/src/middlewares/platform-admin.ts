import { Context, Next } from 'hono';

import { ErrorCodes } from '@api/utils/errors';
import { isPlatformAdminRole } from '@cio/utils/constants';

/**
 * Middleware to check if the authenticated user is a platform admin — the SaaS
 * operator who manages every organization from the cross-org /platform panel.
 *
 * Unlike orgAdminMiddleware, this authorizes against Better Auth's global
 * `user.role` (populated on the session) and deliberately does NOT read the
 * `cio-org-id` header: platform endpoints operate across all organizations, so
 * there is no single active org to scope to.
 *
 * Requires authMiddleware to be applied first.
 */
export const platformAdminMiddleware = async (c: Context, next: Next) => {
  try {
    const user = c.get('user');
    if (!user) {
      return c.json(
        {
          success: false,
          error: 'Unauthorized',
          code: 'UNAUTHORIZED'
        },
        401
      );
    }

    if (!isPlatformAdminRole(user.role)) {
      return c.json(
        {
          success: false,
          error: 'Only platform admins can perform this action',
          code: ErrorCodes.PLATFORM_NOT_AUTHORIZED
        },
        403
      );
    }

    await next();
  } catch (error) {
    console.error('Error in platformAdminMiddleware:', error);
    return c.json(
      {
        success: false,
        error: 'Failed to verify platform admin status',
        code: 'PLATFORM_ADMIN_CHECK_FAILED'
      },
      500
    );
  }
};
