import 'dotenv/config';
import './instrument';

import { API_PORT } from '@api/constants';
import { app } from '@api/app';
import { configureOpenAPI } from '@api/utils/openapi';
import { connectRedis } from '@api/utils/redis/redis';
import { env } from '@api/config/env';
import { isEmailSenderConfigured } from '@cio/email';
import { preloadVerifiedCustomDomainOriginsRegistry } from '@api/utils/origins';
import { serve } from '@hono/node-server';
import { startAuditPurge } from '@api/utils/audit-purge';
import { showRoutes } from 'hono/dev';

// Start server
async function startServer() {
  console.log('Starting server on port:', API_PORT);

  // Connect to Redis (non-blocking: API starts even if Redis fails)
  await connectRedis();

  preloadVerifiedCustomDomainOriginsRegistry().then(() => {
    console.log('Verified custom domain origins preloaded');
  });

  startAuditPurge();

  // Sin SMTP_SENDER, el remitente cae en un placeholder inválido a propósito
  // (para no salir firmado por un tercero) y TODO correo rebota. Que se vea acá
  // y no en el primer reclamo de un alumno que nunca recibió la invitación.
  if (!isEmailSenderConfigured()) {
    console.warn(
      '[email] SMTP_SENDER no está configurado: los correos saldrán con una dirección inválida y van a rebotar.'
    );
  }

  serve({ fetch: app.fetch, port: API_PORT });

  if (env.NODE_ENV !== 'production') {
    showRoutes(app, { colorize: true });
  }
}

await configureOpenAPI(app);

startServer().catch((error) => {
  console.error('Failed to start server:', error);
  if (error instanceof Error && error.stack) {
    console.error(error.stack);
  }
  process.exit(1);
});
