/**
 * Recibe lo que el navegador reporta: errores de JavaScript, requests que
 * fallaron y requests lentos.
 *
 * Es la única forma de enterarse de cosas que el servidor no puede ver:
 *
 *   - Una pantalla que se rompe al dibujarse. La API respondió 200 y quedó tan
 *     contenta. Es exactamente el caso que originó esto: un administrador
 *     mirando el avance de los alumnos, la pantalla rota, y ni un renglón en
 *     ningún lado.
 *   - Un request que nunca llegó (sin conexión, DNS, Nginx caído). Del lado del
 *     servidor no existió.
 *   - Cuánto esperó realmente la persona. La API mide su propio tiempo de
 *     proceso; el navegador mide la espera completa, con la red adentro. Si el
 *     servidor dice 50ms y el navegador 4s, el problema no es la aplicación.
 */

import * as z from 'zod';

import { Hono } from '@api/utils/hono';
import { clientInfoFromHeaders } from '@api/utils/client-info';
import { createRateLimiter } from '@api/middlewares/rate-limiter';
import { ipKeyGenerator } from '@api/utils/redis/key-generators';
import { recordIncident } from '@api/services/audit';

/** Todos los campos con tope de largo: el cuerpo lo controla el cliente. */
const ZIncidentReport = z.object({
  kind: z.enum(['FRONTEND_ERROR', 'REQUEST_FAILED', 'SLOW_REQUEST']),
  message: z.string().trim().min(1).max(2000),
  stack: z.string().max(8000).optional(),
  code: z.string().max(100).optional(),
  status: z.number().int().min(0).max(599).optional(),
  route: z.string().max(1000).optional(),
  method: z.string().max(10).optional(),
  durationMs: z.number().int().min(0).max(600_000).optional(),
  metadata: z.record(z.string(), z.unknown()).optional()
});

/**
 * Tope por IP. El navegador ya se auto-limita (ver `report-incident.ts` en el
 * dashboard), pero esto es lo que impide que alguien use el endpoint para llenar
 * la tabla desde afuera.
 */
const incidentRateLimit = createRateLimiter({
  windowMs: 60 * 1000,
  maxRequests: 60,
  keyGenerator: ipKeyGenerator
});

/**
 * `POST /audit/incident`
 *
 * Sin `authMiddleware` a propósito: un error de la pantalla de ingreso, o uno
 * que ocurre justo cuando la sesión venció, son casos que interesan
 * especialmente y no habría forma de reportarlos si hiciera falta estar
 * autenticado. Si el request trae cookie válida, el middleware global de
 * `app.ts` ya dejó al usuario en el contexto y se aprovecha; si no, la
 * incidencia se guarda igual, sin nombre.
 *
 * Responde 204 SIEMPRE, incluso ante un cuerpo mal formado. Un reporte de error
 * que devuelve error haría que el frontend intente reportar ese error, y así al
 * infinito.
 */
export const auditIncidentRouter = new Hono().post('/', incidentRateLimit, async (c) => {
  try {
    const parsed = ZIncidentReport.safeParse(await c.req.json());

    if (parsed.success) {
      const report = parsed.data;
      const user = c.get('user');
      const session = c.get('session');
      const client = clientInfoFromHeaders(c.req.raw.headers);
      const orgId = c.req.header('cio-org-id') ?? null;

      await recordIncident({
        ...report,
        source: 'FRONTEND',
        orgId,
        userId: user?.id ?? null,
        userLabel: user?.email ?? null,
        sessionId: session?.id ?? null,
        ip: client.ip,
        device: client.device,
        browser: client.browser,
        userAgent: client.userAgent,
        metadata: report.metadata ?? null
      });
    }
  } catch {
    // Cuerpo ilegible o cualquier otra cosa: ver arriba, nunca se responde error.
  }

  return c.body(null, 204);
});
