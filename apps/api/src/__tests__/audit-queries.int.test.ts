/**
 * La capa de queries de auditoría, contra un Postgres de verdad.
 *
 * Todo lo demás del sistema se prueba con mocks. Estas cuatro cosas no se pueden:
 *
 *   1. **Que la ventana anti-repetición funcione con `entity_id` nulo.** En SQL
 *      `null = null` no es verdadero sino desconocido: escrito con `eq` en vez
 *      de `isNull`, el filtro no encuentra nada — y justamente las acciones sin
 *      entidad son las que más se repiten. Un mock no puede notar la diferencia
 *      porque la diferencia la pone el motor.
 *   2. **Que las tablas no tengan claves foráneas.** Es una decisión de diseño
 *      —el registro tiene que sobrevivir al borrado de la empresa o del
 *      usuario— y sólo la base puede confirmarla.
 *   3. **Que un uuid inválido no tumbe el flujo.** El INSERT lo rechaza
 *      Postgres, no TypeScript.
 *   4. **Que `db.$count` y el borrado por fecha hagan lo que se espera.**
 *
 * Se corren aparte, con `pnpm --filter @cio/api test:db`, para que la suite
 * normal siga pasando en una máquina sin Docker.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

import {
  hasRecentAuditEvent,
  insertAuditEvent,
  insertAuditIncident,
  purgeAuditBefore
} from '@cio/db/queries/audit';
import { and, auditEvent, auditIncident, db, eq, like, lt, or } from '@cio/db/drizzle';

/**
 * Marca de esta corrida. Va en la acción y en el `user_label` para poder borrar
 * exactamente lo que estos tests escribieron y nada más: la base de desarrollo
 * es compartida y un `DELETE` amplio se llevaría puestos datos de otra cosa.
 */
const RUN = randomUUID().slice(0, 8);
const MARK = `int-${RUN}@test.local`;
const action = (name: string) => `TEST_${RUN}_${name}`;

const ORG = randomUUID();
const USER = randomUUID();

const baseEvent = {
  orgId: ORG,
  userId: USER,
  userLabel: MARK,
  action: action('BASE'),
  method: 'GET',
  route: '/organization/tracking/overview',
  status: 200,
  durationMs: 42
};

async function cleanup() {
  await db.delete(auditEvent).where(or(eq(auditEvent.userLabel, MARK), like(auditEvent.action, `TEST_${RUN}_%`)));
  await db.delete(auditIncident).where(eq(auditIncident.userLabel, MARK));
}

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

describe('insertAuditEvent', () => {
  it('persiste la fila con el jsonb intacto', async () => {
    expect(await insertAuditEvent({ ...baseEvent, metadata: { scope: 'all', term: 'ana' } })).toBe(true);

    const [row] = await db.select().from(auditEvent).where(eq(auditEvent.action, action('BASE')));

    expect(row).toMatchObject({
      orgId: ORG,
      userId: USER,
      userLabel: MARK,
      route: '/organization/tracking/overview',
      status: 200,
      durationMs: 42,
      // El jsonb vuelve como objeto, no como string: si volviera como texto,
      // consultar `metadata->>'scope'` seguiría andando pero comparar en JS no.
      metadata: { scope: 'all', term: 'ana' }
    });
    expect(row!.createdAt).toBeTruthy();
  });

  it('guarda un evento de una empresa que ya no existe', async () => {
    // ESTA es la decisión de no poner claves foráneas. Con una FK y CASCADE, dar
    // de baja una empresa borraría la historia de lo que se hizo dentro de ella
    // — justo cuando más importa poder mirarla.
    const empresaFantasma = randomUUID();

    expect(await insertAuditEvent({ ...baseEvent, action: action('SIN_FK'), orgId: empresaFantasma })).toBe(true);

    const [row] = await db.select().from(auditEvent).where(eq(auditEvent.action, action('SIN_FK')));
    expect(row!.orgId).toBe(empresaFantasma);
  });

  it('devuelve false en vez de tirar cuando la fila no entra', async () => {
    // `org_id` es `uuid`: Postgres rechaza el INSERT entero. El que llama está
    // en el camino de un request que ya terminó y no puede recibir una excepción.
    // El log del rechazo se silencia: es el camino esperado de este test, y su
    // stack tapaba la salida del suite.
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const inserted = await insertAuditEvent({
      ...baseEvent,
      action: action('UUID_INVALIDO'),
      orgId: 'no-soy-un-uuid'
    });

    expect(inserted).toBe(false);
    vi.restoreAllMocks();
  });

  it('acepta que no haya empresa ni usuario', async () => {
    // Pasa de verdad: las rutas de plataforma son cross-empresa y no tienen
    // `cio-org-id`.
    expect(
      await insertAuditEvent({ ...baseEvent, action: action('SIN_ORG'), orgId: null, userId: null })
    ).toBe(true);
  });
});

describe('hasRecentAuditEvent', () => {
  const since = () => new Date(Date.now() - 5 * 60 * 1000).toISOString();

  it('encuentra una repetición dentro de la ventana', async () => {
    await insertAuditEvent({ ...baseEvent, action: action('REPE'), entityId: 'curso-1' });

    const repeated = await hasRecentAuditEvent({
      orgId: ORG,
      userId: USER,
      action: action('REPE'),
      entityId: 'curso-1',
      since: since()
    });

    expect(repeated).toBe(true);
  });

  it('funciona con entityId nulo', async () => {
    // El test que justifica todo este archivo. Escrito con `eq(entity_id, null)`
    // en vez de `IS NULL`, esto daría false y la ventana no filtraría NADA en
    // las acciones sin entidad — que son las que más se repiten (entrar al
    // tablero, abrir el seguimiento). El registro se llenaría de duplicados y
    // los mocks seguirían en verde.
    await insertAuditEvent({ ...baseEvent, action: action('NULO'), entityId: null });

    const repeated = await hasRecentAuditEvent({
      orgId: ORG,
      userId: USER,
      action: action('NULO'),
      entityId: null,
      since: since()
    });

    expect(repeated).toBe(true);
  });

  it('lo mismo cuando además no hay empresa ni usuario', async () => {
    await insertAuditEvent({ ...baseEvent, action: action('TODO_NULO'), orgId: null, userId: null });

    const repeated = await hasRecentAuditEvent({
      orgId: null,
      userId: null,
      action: action('TODO_NULO'),
      entityId: null,
      since: since()
    });

    expect(repeated).toBe(true);
  });

  it('no confunde una entidad con otra', async () => {
    await insertAuditEvent({ ...baseEvent, action: action('ENTIDAD'), entityId: 'curso-1' });

    const other = await hasRecentAuditEvent({
      orgId: ORG,
      userId: USER,
      action: action('ENTIDAD'),
      entityId: 'curso-2',
      since: since()
    });

    expect(other).toBe(false);
  });

  it('un evento CON entidad no tapa a uno SIN entidad', async () => {
    // El reverso del caso nulo: si `IS NULL` se aplicara de más, un evento con
    // entidad haría creer que ya se registró el que no la tiene.
    await insertAuditEvent({ ...baseEvent, action: action('MIXTO'), entityId: 'curso-1' });

    const withoutEntity = await hasRecentAuditEvent({
      orgId: ORG,
      userId: USER,
      action: action('MIXTO'),
      entityId: null,
      since: since()
    });

    expect(withoutEntity).toBe(false);
  });

  it('no confunde a dos personas ni a dos empresas', async () => {
    await insertAuditEvent({ ...baseEvent, action: action('QUIEN') });

    const otherUser = await hasRecentAuditEvent({
      orgId: ORG,
      userId: randomUUID(),
      action: action('QUIEN'),
      entityId: null,
      since: since()
    });
    const otherOrg = await hasRecentAuditEvent({
      orgId: randomUUID(),
      userId: USER,
      action: action('QUIEN'),
      entityId: null,
      since: since()
    });

    expect([otherUser, otherOrg]).toEqual([false, false]);
  });

  it('respeta la ventana temporal', async () => {
    // Un evento de hace una hora no debe frenar el de ahora: si la persona
    // vuelve a mirar la misma pantalla más tarde, eso es un hecho nuevo.
    const anHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    await insertAuditEvent({ ...baseEvent, action: action('VIEJO'), createdAt: anHourAgo });

    const withinFiveMinutes = await hasRecentAuditEvent({
      orgId: ORG,
      userId: USER,
      action: action('VIEJO'),
      entityId: null,
      since: since()
    });

    expect(withinFiveMinutes).toBe(false);
  });
});

describe('insertAuditIncident', () => {
  it('persiste una incidencia con su stack y su metadata', async () => {
    const inserted = await insertAuditIncident({
      kind: 'FRONTEND_ERROR',
      source: 'FRONTEND',
      message: "Cannot read properties of undefined (reading 'byStudent')",
      stack: 'TypeError: ...\n    at Seguimiento',
      route: '/organization/tracking/overview',
      status: 500,
      orgId: ORG,
      userLabel: MARK,
      metadata: { screen: '/org/egea/seguimiento', origin: 'svelte.boundary' }
    });

    expect(inserted).toBe(true);

    const [row] = await db.select().from(auditIncident).where(eq(auditIncident.userLabel, MARK));
    expect(row).toMatchObject({
      kind: 'FRONTEND_ERROR',
      source: 'FRONTEND',
      status: 500,
      metadata: { screen: '/org/egea/seguimiento', origin: 'svelte.boundary' }
    });
    expect(row!.stack).toContain('Seguimiento');
  });

  it('aguanta un mensaje largo sin recortar por su cuenta', async () => {
    // Las columnas son `text`, sin tope. El recorte lo hace el service, y tiene
    // que ser el único lugar donde pasa: si además recortara la base, dos topes
    // distintos discutirían en silencio.
    await insertAuditIncident({
      kind: 'BACKEND_ERROR',
      source: 'BACKEND',
      message: 'm'.repeat(2000),
      stack: 's'.repeat(8000),
      userLabel: MARK
    });

    const [row] = await db.select().from(auditIncident).where(eq(auditIncident.userLabel, MARK));
    expect(row!.message).toHaveLength(2000);
    expect(row!.stack).toHaveLength(8000);
  });
});

describe('purgeAuditBefore', () => {
  // Año 1999 a propósito: el corte sólo puede alcanzar filas que estos tests
  // escribieron. Con una fecha reciente, la purga se llevaría datos reales de la
  // base de desarrollo, que es compartida.
  const ANCIENT = '1999-01-01T00:00:00.000Z';
  const CUTOFF = '2000-01-01T00:00:00.000Z';

  it('borra lo anterior al corte y deja lo de ahora', async () => {
    await insertAuditEvent({ ...baseEvent, action: action('ANTIGUO'), createdAt: ANCIENT });
    await insertAuditEvent({ ...baseEvent, action: action('RECIENTE') });
    await insertAuditIncident({
      kind: 'BACKEND_ERROR',
      source: 'BACKEND',
      message: 'viejo',
      userLabel: MARK,
      createdAt: ANCIENT
    });

    const result = await purgeAuditBefore(CUTOFF);

    expect(result.events).toBeGreaterThanOrEqual(1);
    expect(result.incidents).toBeGreaterThanOrEqual(1);

    const survivors = await db
      .select({ action: auditEvent.action })
      .from(auditEvent)
      .where(like(auditEvent.action, `TEST_${RUN}_%`));

    expect(survivors.map((row) => row.action)).toEqual([action('RECIENTE')]);
    expect(
      await db.select().from(auditIncident).where(eq(auditIncident.userLabel, MARK))
    ).toHaveLength(0);
  });

  it('devuelve cero cuando no hay nada que sacar', async () => {
    await insertAuditEvent({ ...baseEvent, action: action('NADA_QUE_BORRAR') });

    const result = await purgeAuditBefore(CUTOFF);

    expect(result).toEqual({ events: 0, incidents: 0 });
  });

  it('la cuenta que informa coincide con lo que borró', async () => {
    // `purgeAuditBefore` cuenta ANTES de borrar, en dos consultas separadas. Si
    // el `where` del conteo y el del DELETE se separaran, el número del log
    // dejaría de significar nada.
    for (const suffix of ['A', 'B', 'C']) {
      await insertAuditEvent({ ...baseEvent, action: action(`CUENTA_${suffix}`), createdAt: ANCIENT });
    }

    const before = await db
      .select({ id: auditEvent.id })
      .from(auditEvent)
      .where(and(like(auditEvent.action, `TEST_${RUN}_%`), lt(auditEvent.createdAt, CUTOFF)));

    const result = await purgeAuditBefore(CUTOFF);

    expect(before).toHaveLength(3);
    expect(result.events).toBe(3);
  });
});
