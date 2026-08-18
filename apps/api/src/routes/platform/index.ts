import { Hono } from '@api/utils/hono';
import { platformOrganizationsRouter } from './organizations';
import { platformSettingsRouter } from './settings';

export const platformRouter = new Hono()
  .route('/organizations', platformOrganizationsRouter)
  .route('/settings', platformSettingsRouter);
