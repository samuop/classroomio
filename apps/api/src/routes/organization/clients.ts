import { AppError, ErrorCodes, handleError } from '@api/utils/errors';

import { Hono } from '@api/utils/hono';
import { authMiddleware } from '@api/middlewares/auth';
import { getClientCompaniesOverview } from '@api/services/organization/clients';
import { getOrganizationById } from '@cio/db/queries/organization';
import { orgAdminMiddleware } from '@api/middlewares/org-admin';

/**
 * A consultancy's clients, side by side.
 *
 * GET /organization/clients/overview — admin of the consultancy only.
 */
export const organizationClientsRouter = new Hono().get('/overview', authMiddleware, orgAdminMiddleware, async (c) => {
  try {
    const orgId = c.req.header('cio-org-id')!;

    const organization = await getOrganizationById(orgId);
    if (!organization) {
      throw new AppError('Organization not found', ErrorCodes.ORGANIZATION_NOT_FOUND, 404);
    }

    // Asked from inside a client company, this would list that client's own
    // children — of which it has none — and quietly answer with an empty page
    // instead of saying the question does not apply here.
    if (organization.parentOrganizationId) {
      throw new AppError(
        'Client companies are managed from the primary workspace',
        ErrorCodes.NOT_PRIMARY_WORKSPACE,
        403
      );
    }

    const overview = await getClientCompaniesOverview(orgId);

    return c.json({ success: true as const, data: overview });
  } catch (error) {
    return handleError(c, error, 'Failed to fetch client companies overview');
  }
});
