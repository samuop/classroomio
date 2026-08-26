/**
 * De un request HTTP a una fila en Postgres, sin un solo mock.
 *
 * Los otros archivos prueban cada capa contra dobles: el middleware contra un
 * servicio falso, el servicio contra queries falsas. Eso deja un hueco que sólo
 * se ve cuando las piezas se tocan de verdad — un campo que el middleware manda
 * y la tabla no tiene, un uuid que nadie saneó, un jsonb que no entra. Este
 * archivo cierra ese hueco: middleware real, servicio real, base real.
 *
 * Se corre con `pnpm --filter @cio/api test:db`.
 */
import { Hono } from 'hono';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';

import { auditEvent, auditIncident, db, desc, eq, like, or } from '@cio/db/drizzle';

import { auditRequest } from '@api/middlewares/audit-request';
import { auditRouter } from '@api/routes/audit';

const RUN = randomUUID().slice(0, 8);
const MARK = `e2e-${RUN}@test.local`;

const ORG = randomUUID();
const USER = randomUUID();
const SESSION = randomUUID();

const CHROME_WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

/**
 * La escritura se dispara sin `await` para no demorar la respuesta, y acá encima
 * termina en un INSERT contra Postgres. Hay que esperar de verdad, no un tick.
 */
const waitForWrite = async () => {
  for (let attempt = 0; attempt < 40; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    const [row] = await db.select({ id: auditEvent.id }).from(auditEvent).where(eq(auditEvent.userLabel, MARK));
    if (row) return;
  }
};

const waitForIncident = async () => {
  for (let attempt = 0; attempt < 40; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    const [row] = await db
      .select({ id: auditIncident.id })
      .from(auditIncident)
      .where(eq(auditIncident.userLabel, MARK));
    if (row) return;
  }
};

const app = new Hono()
  .use('*', auditRequest)
  // Replica a `authMiddleware` + `orgMemberMiddleware`: corren DESPUÉS de la
  // auditoría, que igual los ve porque lee al volver de `next()`.
  .use('*', async (c, next) => {
    c.set('user' as never, { id: USER, email: MARK, role: null } as never);
    c.set('session' as never, { id: SESSION } as never);
    c.set('orgId' as never, ORG as never);
    // Ver la nota de `audit-middleware.test.ts`: `orgRoles` es lo que arma
    // `app.ts` para toda sesión; `userRole` sólo lo pone una rama.
    c.set('orgRoles' as never, { [ORG]: 1 } as never);

    await next();
  })
  .get('/organization/tracking/overview', (c) => c.json({ ok: true }))
  .put('/organization', (c) => c.json({ ok: true }))
  .get('/explota', () => {
    throw new Error('Cannot read properties of undefined (reading "byStudent")');
  })
  .route('/audit', auditRouter);

async function cleanup() {
  await db.delete(auditEvent).where(or(eq(auditEvent.userLabel, MARK), like(auditEvent.action, `%${RUN}%`)));
  await db.delete(auditIncident).where(eq(auditIncident.userLabel, MARK));
}

const lastEvent = async () =>
  (
    await db
      .select()
      .from(auditEvent)
      .where(eq(auditEvent.userLabel, MARK))
      .orderBy(desc(auditEvent.createdAt))
      .limit(1)
  )[0];

const lastIncident = async () =>
  (
    await db
      .select()
      .from(auditIncident)
      .where(eq(auditIncident.userLabel, MARK))
      .orderBy(desc(auditIncident.createdAt))
      .limit(1)
  )[0];

beforeAll(async () => {
  try {
    await db.select({ id: auditEvent.id }).from(auditEvent).limit(1);
  } catch (error) {
    throw new Error(
      'No se pudo hablar con Postgres. Levantá la base y sincronizá el schema:\n' +
        '  docker compose -f docker/docker-compose.yaml up -d postgres\n' +
        '  pnpm --filter @cio/db db:setup\n' +
        `Detalle: ${error instanceof Error ? error.message : String(error)}`
    );
  }
});

beforeEach(cleanup);
afterAll(cleanup);

describe('una lectura declarada, de punta a punta', () => {
  it('deja una fila con quién, qué, cuándo, desde dónde y cuánto tardó', async () => {
    const response = await app.request('/organization/tracking/overview?scope=all', {
      headers: { 'user-agent': CHROME_WINDOWS, 'cf-connecting-ip': '203.0.113.10' }
    });
    await waitForWrite();

    expect(response.status).toBe(200);

    const row = await lastEvent();
    expect(row).toBeDefined();
    // La pregunta original, respondida por una sola fila: qué endpoint se llamó,
    // quién lo hizo, cuándo, con qué usuario, desde qué dispositivo y los tiempos.
    expect(row).toMatchObject({
      action: 'VIO_SEGUIMIENTO',
      route: '/organization/tracking/overview',
      method: 'GET',
      status: 200,
      userId: USER,
      userLabel: MARK,
      orgId: ORG,
      orgRole: 1,
      sessionId: SESSION,
      ip: '203.0.113.10',
      device: 'Windows',
      browser: 'Chrome',
      metadata: { scope: 'all' }
    });
    expect(row!.durationMs).toBeGreaterThanOrEqual(0);
    expect(new Date(row!.createdAt).getTime()).toBeGreaterThan(Date.now() - 60_000);
  });

  it('la ventana anti-repetición aguanta contra la base real', async () => {
    // Es el único lugar donde se prueba de punta a punta: el servicio consulta
    // la tabla que él mismo acaba de escribir, con el `IS NULL` de por medio.
    for (let i = 0; i < 3; i++) {
      await app.request('/organization/tracking/overview', { headers: { 'user-agent': CHROME_WINDOWS } });
      await waitForWrite();
    }

    const rows = await db.select().from(auditEvent).where(eq(auditEvent.userLabel, MARK));
    expect(rows).toHaveLength(1);
  });
});

describe('una escritura, de punta a punta', () => {
  it('se registra aunque no esté declarada, y sin ventana', async () => {
    await app.request('/organization', { method: 'PUT', headers: { 'user-agent': CHROME_WINDOWS } });
    await waitForWrite();
    await app.request('/organization', { method: 'PUT', headers: { 'user-agent': CHROME_WINDOWS } });
    await new Promise((resolve) => setTimeout(resolve, 400));

    const rows = await db.select().from(auditEvent).where(eq(auditEvent.userLabel, MARK));

    // Dos ediciones son dos hechos: la ventana no aplica a las escrituras.
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ action: 'EDITO_EMPRESA', method: 'PUT' });
  });
});

describe('un error del servidor, de punta a punta', () => {
  it('deja la incidencia con el mensaje real y su stack', async () => {
    const response = await app.request('/explota', { headers: { 'user-agent': CHROME_WINDOWS } });
    await waitForIncident();

    expect(response.status).toBe(500);

    const row = await lastIncident();
    expect(row).toMatchObject({
      kind: 'BACKEND_ERROR',
      source: 'BACKEND',
      status: 500,
      route: '/explota',
      userId: USER,
      device: 'Windows'
    });
    expect(row!.message).toContain('byStudent');
    expect(row!.stack).toContain('Error');

    // Un fallo no deja acción: no ocurrió nada que registrar como hecho.
    expect(await db.select().from(auditEvent).where(eq(auditEvent.userLabel, MARK))).toHaveLength(0);
  });
});

describe('el reporte del navegador, de punta a punta', () => {
  it('una pantalla rota llega a la tabla con la pantalla donde estaba', async () => {
    // El caso que originó todo: la pantalla se rompe, la API respondió 200 y no
    // quedaba rastro. Ahora queda esta fila.
    const response = await app.request('/audit/incident', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': CHROME_WINDOWS,
        'cio-org-id': ORG,
        'cf-connecting-ip': '203.0.113.10'
      },
      body: JSON.stringify({
        kind: 'FRONTEND_ERROR',
        message: "Cannot read properties of undefined (reading 'byStudent')",
        stack: 'TypeError: ...\n    at Seguimiento',
        route: '/organization/tracking/overview',
        metadata: { screen: '/org/consultora/seguimiento', origin: 'svelte.boundary' }
      })
    });

    expect(response.status).toBe(204);

    const row = await lastIncident();
    expect(row).toMatchObject({
      kind: 'FRONTEND_ERROR',
      source: 'FRONTEND',
      orgId: ORG,
      userId: USER,
      userLabel: MARK,
      ip: '203.0.113.10',
      device: 'Windows',
      browser: 'Chrome',
      metadata: { screen: '/org/consultora/seguimiento', origin: 'svelte.boundary' }
    });
  });

  it('el propio reporte no se audita a sí mismo', async () => {
    await app.request('/audit/incident', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'FRONTEND_ERROR', message: 'boom' })
    });
    await new Promise((resolve) => setTimeout(resolve, 400));

    // Es un POST, o sea una escritura: sin la exclusión quedaría además un
    // evento `POST /audit/incident` por cada error reportado.
    expect(await db.select().from(auditEvent).where(eq(auditEvent.userLabel, MARK))).toHaveLength(0);
  });
});
