import { listProgramsService } from '@api/services/v1/program';

import { Hono } from '@api/utils/hono';
import { automationKeyMiddleware } from '@api/middlewares/automation-key';
import { automationKeyScopesMiddleware } from '@api/middlewares/automation-key-scopes';
import { handleError } from '@api/utils/errors';
import { describeRoute } from 'hono-openapi';

const ProgramsListResponse = {
  type: 'object' as const,
  properties: {
    success: { type: 'boolean' as const },
    data: { type: 'array' as const, items: { type: 'object' as const } }
  },
  required: ['success', 'data']
};

export const v1ProgramsRouter = new Hono().get(
  '/',
  automationKeyMiddleware,
  automationKeyScopesMiddleware(['public_api:*']),
  describeRoute({
    description: 'List the active programs of the authenticated organization, each with its courses',
    tags: ['Public API Programs'],
    responses: {
      200: {
        description: 'Programs returned successfully',
        content: {
          'application/json': {
            schema: ProgramsListResponse
          }
        }
      },
      401: { description: 'Unauthorized' },
      403: { description: 'Forbidden' }
    }
  }),
  async (c) => {
    try {
      const orgId = c.get('orgId')!;
      const programs = await listProgramsService(orgId);

      return c.json(
        {
          success: true,
          data: programs
        },
        200
      );
    } catch (error) {
      return handleError(c, error, 'Failed to list programs');
    }
  }
);
