import { Hono } from '@api/utils/hono';
import { platformOrganizationsRouter } from './organizations';

export const platformRouter = new Hono().route('/organizations', platformOrganizationsRouter);
