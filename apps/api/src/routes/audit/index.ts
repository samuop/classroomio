import { Hono } from '@api/utils/hono';
import { auditIncidentRouter } from './incident';

export const auditRouter = new Hono().route('/incident', auditIncidentRouter);
