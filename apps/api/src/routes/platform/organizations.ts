import {
  ZPlatformCreateOrg,
  ZPlatformDomainAction,
  ZPlatformOrgIdParam,
  ZPlatformOrgListQuery,
  ZPlatformSetPlan,
  ZPlatformSuspendOrg,
  ZPlatformUpdateOrg
} from '@cio/utils/validation/platform';
import {
  connectOrgCustomDomain,
  createOrganization,
  getOrganizationDetail,
  listOrganizations,
  refreshOrgCustomDomain,
  removeOrgCustomDomain,
  setOrganizationPlan,
  suspendOrganization,
  updateOrganization
} from '@api/services/platform/platform';
import { AppError, handleError } from '@api/utils/errors';
import { anotarAuditoria } from '@api/utils/audit-detail';
import { getActiveOrganizationPlan } from '@cio/db/queries/organization';

import { Hono } from '@api/utils/hono';
import { authMiddleware } from '@api/middlewares/auth';
import { platformAdminMiddleware } from '@api/middlewares/platform-admin';
import { zValidator } from '@hono/zod-validator';

/**
 * Lo que la auditoría guarda de un plan: el nombre y los tres números que
 * deciden cuánta plata puede gastar una empresa. El resto del payload no.
 */
async function resumenDelPlan(orgId: string): Promise<Record<string, unknown> | null> {
  try {
    const plan = await getActiveOrganizationPlan(orgId);
    if (!plan) return null;

    const payload = (plan.payload ?? {}) as Record<string, unknown>;

    return {
      plan: plan.planName ?? null,
      cupoDeFichas: payload.aiTokenAllowance ?? null,
      cupoDeImagenes: payload.aiImageAllowance ?? null,
      modelo: payload.aiModel ?? null
    };
  } catch {
    // La auditoría no puede tumbar el cambio de plan.
    return null;
  }
}

export const platformOrganizationsRouter = new Hono()
  .get('/', authMiddleware, platformAdminMiddleware, zValidator('query', ZPlatformOrgListQuery), async (c) => {
    try {
      const { page, limit, search, sortBy, sortOrder } = c.req.valid('query');
      const result = await listOrganizations({ page, limit, search, sortBy, sortOrder });

      return c.json({ success: true as const, data: result.items, pagination: result.pagination });
    } catch (error) {
      return handleError(c, error, 'Failed to list organizations');
    }
  })
  .post('/', authMiddleware, platformAdminMiddleware, zValidator('json', ZPlatformCreateOrg), async (c) => {
    try {
      const body = c.req.valid('json');
      const organization = await createOrganization(body);

      return c.json({ success: true as const, data: organization }, 201);
    } catch (error) {
      return handleError(c, error, 'Failed to create organization');
    }
  })
  .get('/:orgId', authMiddleware, platformAdminMiddleware, zValidator('param', ZPlatformOrgIdParam), async (c) => {
    try {
      const { orgId } = c.req.valid('param');
      const detail = await getOrganizationDetail(orgId);

      return c.json({ success: true as const, data: detail });
    } catch (error) {
      return handleError(c, error, 'Failed to fetch organization');
    }
  })
  .put(
    '/:orgId',
    authMiddleware,
    platformAdminMiddleware,
    zValidator('param', ZPlatformOrgIdParam),
    zValidator('json', ZPlatformUpdateOrg),
    async (c) => {
      try {
        const { orgId } = c.req.valid('param');
        const data = c.req.valid('json');
        anotarAuditoria(c, { orgId, metadata: { campos: Object.keys(data) } });
        const updated = await updateOrganization(orgId, data);

        return c.json({ success: true as const, data: updated });
      } catch (error) {
        return handleError(c, error, 'Failed to update organization');
      }
    }
  )
  .post(
    '/:orgId/suspend',
    authMiddleware,
    platformAdminMiddleware,
    zValidator('param', ZPlatformOrgIdParam),
    zValidator('json', ZPlatformSuspendOrg),
    async (c) => {
      try {
        const { orgId } = c.req.valid('param');
        const { suspend, readOnlyUntil } = c.req.valid('json');
        anotarAuditoria(c, { orgId, metadata: { suspender: suspend, soloLecturaHasta: readOnlyUntil ?? null } });
        const updated = await suspendOrganization(orgId, suspend, readOnlyUntil);

        return c.json({ success: true as const, data: updated });
      } catch (error) {
        return handleError(c, error, 'Failed to update organization suspension');
      }
    }
  )
  .put(
    '/:orgId/plan',
    authMiddleware,
    platformAdminMiddleware,
    zValidator('param', ZPlatformOrgIdParam),
    zValidator('json', ZPlatformSetPlan),
    async (c) => {
      try {
        const { orgId } = c.req.valid('param');
        const { planName, aiTokenAllowance, aiModel, aiImageAllowance } = c.req.valid('json');
        // El antes y el después: «le cambió el plan» no dice si el cupo subió de 15
        // a 90 millones, y eso es lo que alguien va a querer saber.
        const antes = await resumenDelPlan(orgId);
        anotarAuditoria(c, { orgId, metadata: { antes } });
        const result = await setOrganizationPlan(orgId, planName, aiTokenAllowance, aiModel, aiImageAllowance);
        anotarAuditoria(c, { metadata: { despues: await resumenDelPlan(orgId) } });

        return c.json({ success: true as const, data: result });
      } catch (error) {
        return handleError(c, error, 'Failed to update organization plan');
      }
    }
  )
  .post(
    '/:orgId/domain',
    authMiddleware,
    platformAdminMiddleware,
    zValidator('param', ZPlatformOrgIdParam),
    zValidator('json', ZPlatformDomainAction),
    async (c) => {
      try {
        const { orgId } = c.req.valid('param');
        const { action, domain } = c.req.valid('json');
        anotarAuditoria(c, { orgId, metadata: { accion: action, dominio: domain ?? null } });

        switch (action) {
          case 'connect': {
            if (!domain) {
              throw new AppError('A domain is required to connect', 'VALIDATION_ERROR', 400, 'domain');
            }

            const result = await connectOrgCustomDomain(orgId, domain);
            return c.json({ success: true as const, data: result });
          }
          case 'refresh': {
            const result = await refreshOrgCustomDomain(orgId);
            return c.json({ success: true as const, data: result });
          }
          case 'remove': {
            const result = await removeOrgCustomDomain(orgId);
            return c.json({ success: true as const, data: result });
          }
        }
      } catch (error) {
        return handleError(c, error, 'Failed to process domain request');
      }
    }
  );
