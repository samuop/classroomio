import { Hono } from 'hono';
import { env } from '@api/config/env';
import { AuthSession } from '@api/types/auth';

export async function configureOpenAPI(app: Hono<AuthSession>) {
  if (env.OPENAPI_URL) {
    const { Scalar } = await import('@scalar/hono-api-reference');

    app.get('/docs', Scalar({ url: env.OPENAPI_URL, theme: 'none' }));
  }
}
