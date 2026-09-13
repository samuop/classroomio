/**
 * Quién puede sumarle crédito de IA a una empresa.
 *
 * El crédito se gasta cuando se acaba el cupo del plan, así que cargarlo es
 * levantar el tope de gasto de una empresa. Hasta este arreglo había dos puertas
 * abiertas, y las dos se prueban acá contra el router real de créditos:
 *
 *   1. `POST /agent/credits` pasaba con `orgAdminMiddleware`: cualquier admin de
 *      empresa se sumaba el crédito que quisiera, sin pagar.
 *   2. `POST /agent/credits/purchase` pasaba con `authOrApiKeyMiddleware`, que
 *      deja entrar CUALQUIER sesión; como el cuerpo trae el `orgId` y las fichas,
 *      un estudiante logueado se cargaba crédito ilimitado en cualquier empresa.
 *
 * Ahora la primera es sólo de la plataforma y la segunda sólo de la clave de
 * servidor (el webhook del proveedor de pagos, que verifica la firma antes).
 */
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PLATFORM_ROLE, ROLE } from '@cio/utils/constants';

const CLAVE_DE_SERVIDOR = 'clave-de-servidor-solo-para-este-test';
process.env.PRIVATE_SERVER_KEY = CLAVE_DE_SERVIDOR;

const addCredits = vi.fn(async () => 1_000_000);
const recordCreditPurchase = vi.fn(async (body: Record<string, unknown>) => ({ id: 'compra-1', ...body }));

vi.mock('@api/services/agent/usage', () => ({
  addCredits: (...args: unknown[]) => addCredits(...(args as [])),
  getTokenBalance: async () => ({ used: 0, allowance: 0, creditBalance: 1_000_000, remaining: 1_000_000 })
}));

vi.mock('@api/services/agent/credit-purchase', () => ({
  recordCreditPurchase: (body: Record<string, unknown>) => recordCreditPurchase(body)
}));

const { agentCreditsRouter } = await import('@api/routes/agent/credits');

const EMPRESA = '3f1c9f2e-8a4b-4c1d-9e7a-2b5d6c8f0a13';

type Persona = { id: string; email: string; role: string | null } | null;

const ADMIN_DE_EMPRESA: Persona = { id: 'u-admin', email: 'admin@empresa-ejemplo.test', role: null };
const ESTUDIANTE: Persona = { id: 'u-estudiante', email: 'estudiante@empresa-ejemplo.test', role: null };
const PLATAFORMA: Persona = { id: 'u-plataforma', email: 'operacion@plataforma-ejemplo.test', role: PLATFORM_ROLE.ADMIN };

/** Monta el router real detrás de una sesión armada a mano, como hace `app.ts`. */
function appCon(persona: Persona, rolEnLaEmpresa: number | null) {
  return new Hono()
    .use('*', async (c, next) => {
      c.set('user' as never, persona as never);
      c.set('session' as never, (persona ? { id: 's1' } : null) as never);
      c.set('orgRoles' as never, (rolEnLaEmpresa === null ? {} : { [EMPRESA]: rolEnLaEmpresa }) as never);
      await next();
    })
    // Montado donde lo monta `agentRouter`, para que las rutas sean las reales.
    .route('/agent/credits', agentCreditsRouter);
}

const cargar = (persona: Persona, rol: number | null, headers: Record<string, string> = { 'cio-org-id': EMPRESA }) =>
  appCon(persona, rol).request('/agent/credits', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ amount: 5_000_000 })
  });

const compra = {
  orgId: EMPRESA,
  providerOrderId: 'orden-1',
  tokens: 50_000_000,
  quantity: 1,
  unitPriceCents: 0,
  currency: 'USD'
};

const registrarCompra = (persona: Persona, headers: Record<string, string> = {}) =>
  appCon(persona, persona ? ROLE.STUDENT : null).request('/agent/credits/purchase', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(compra)
  });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /agent/credits: sólo la plataforma carga crédito', () => {
  it('un admin de empresa ya no puede sumarse crédito', async () => {
    const respuesta = await cargar(ADMIN_DE_EMPRESA, ROLE.ADMIN);

    expect(respuesta.status).toBe(403);
    expect(addCredits).not.toHaveBeenCalled();
  });

  it('un estudiante tampoco', async () => {
    const respuesta = await cargar(ESTUDIANTE, ROLE.STUDENT);

    expect(respuesta.status).toBe(403);
    expect(addCredits).not.toHaveBeenCalled();
  });

  it('sin sesión, nadie', async () => {
    const respuesta = await cargar(null, null);

    expect(respuesta.status).toBe(401);
    expect(addCredits).not.toHaveBeenCalled();
  });

  it('la plataforma sí, en la empresa del header', async () => {
    const respuesta = await cargar(PLATAFORMA, null);

    expect(respuesta.status).toBe(200);
    expect(addCredits).toHaveBeenCalledWith(EMPRESA, 5_000_000);
  });

  it('la plataforma sin una empresa válida no carga nada', async () => {
    const sinHeader = await cargar(PLATAFORMA, null, {});
    const inventada = await cargar(PLATAFORMA, null, { 'cio-org-id': 'cualquier-cosa' });

    expect(sinHeader.status).toBe(400);
    expect(inventada.status).toBe(400);
    expect(addCredits).not.toHaveBeenCalled();
  });
});

describe('POST /agent/credits/purchase: sólo la clave de servidor', () => {
  it('una sesión cualquiera ya no registra una compra', async () => {
    const estudiante = await registrarCompra(ESTUDIANTE);
    const plataforma = await registrarCompra(PLATAFORMA);

    expect(estudiante.status).toBe(401);
    expect(plataforma.status).toBe(401);
    expect(recordCreditPurchase).not.toHaveBeenCalled();
  });

  it('una clave equivocada tampoco', async () => {
    const respuesta = await registrarCompra(ESTUDIANTE, { authorization: 'Bearer otra-clave' });

    expect(respuesta.status).toBe(401);
    expect(recordCreditPurchase).not.toHaveBeenCalled();
  });

  it('la clave de servidor sí', async () => {
    const respuesta = await registrarCompra(null, { authorization: `Bearer ${CLAVE_DE_SERVIDOR}` });

    expect(respuesta.status).toBe(200);
    expect(recordCreditPurchase).toHaveBeenCalledWith(expect.objectContaining({ orgId: EMPRESA, tokens: 50_000_000 }));
  });
});
