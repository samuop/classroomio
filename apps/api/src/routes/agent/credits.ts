import { ZAgentCreditPurchase, ZAgentCreditsBody } from '@cio/utils/validation/agent';
import { zValidator } from '@hono/zod-validator';

import { Hono } from '@api/utils/hono';
import { AppError, handleError } from '@api/utils/errors';
import { anotarAuditoria } from '@api/utils/audit-detail';
import { apiKeyMiddleware } from '@api/middlewares/api-key';
import { authMiddleware } from '@api/middlewares/auth';
import { platformAdminMiddleware } from '@api/middlewares/platform-admin';
import { addCredits, getTokenBalance } from '@api/services/agent/usage';
import { recordCreditPurchase } from '@api/services/agent/credit-purchase';

const UUID_DE_EMPRESA = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * El crédito de IA de una empresa.
 *
 * El crédito se gasta DESPUÉS del cupo del plan: cargarlo es subirle el tope de
 * gasto a una empresa, y la factura del proveedor la paga la plataforma. Por eso
 * estas dos rutas viven aparte del resto del asistente, con sus guardias a la
 * vista y probadas en `creditos-solo-plataforma.test.ts`.
 */
export const agentCreditsRouter = new Hono()
  /**
   * POST /agent/credits — suma crédito a la empresa del header, sin pago.
   *
   * SÓLO la plataforma. Antes pasaba con `orgAdminMiddleware`: cualquier admin de
   * empresa se sumaba el crédito que quisiera y el tope dejaba de existir.
   */
  .post('/', authMiddleware, platformAdminMiddleware, zValidator('json', ZAgentCreditsBody), async (c) => {
    try {
      const orgId = c.req.header('cio-org-id')?.trim() ?? '';
      const { amount } = c.req.valid('json');

      anotarAuditoria(c, { orgId, entity: 'Organization', entityId: orgId, metadata: { cantidad: amount } });

      if (!UUID_DE_EMPRESA.test(orgId)) {
        throw new AppError('A valid cio-org-id header is required', 'VALIDATION_ERROR', 400);
      }

      await addCredits(orgId, amount);
      const balance = await getTokenBalance(orgId);

      anotarAuditoria(c, { metadata: { saldoDeCreditos: balance.creditBalance } });

      return c.json({ success: true, data: balance });
    } catch (error) {
      return handleError(c, error, 'Failed to purchase credits');
    }
  })
  /**
   * POST /agent/credits/purchase — registra un pack de crédito ya pagado.
   *
   * SÓLO con la clave de servidor: lo llama el webhook del dashboard DESPUÉS de
   * verificar la firma del proveedor de pagos. Antes usaba `authOrApiKeyMiddleware`,
   * que deja pasar cualquier sesión, y el cuerpo trae el `orgId` y las fichas:
   * cualquier persona logueada —un estudiante incluido— se cargaba crédito sin
   * límite en la empresa que eligiera, sin pagar nada.
   */
  .post('/purchase', apiKeyMiddleware, zValidator('json', ZAgentCreditPurchase), async (c) => {
    try {
      const body = c.req.valid('json');

      anotarAuditoria(c, {
        actor: 'webhook de pago',
        orgId: body.orgId,
        entity: 'Organization',
        entityId: body.orgId,
        metadata: {
          ordenDelProveedor: body.providerOrderId,
          fichas: body.tokens,
          cantidad: body.quantity,
          precioUnitarioCentavos: body.unitPriceCents,
          moneda: body.currency
        }
      });

      const purchase = await recordCreditPurchase(body);

      return c.json({ success: true, data: purchase });
    } catch (error) {
      return handleError(c, error, 'Failed to record credit purchase');
    }
  });
