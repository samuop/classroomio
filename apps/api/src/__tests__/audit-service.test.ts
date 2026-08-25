/**
 * El servicio de auditoría: lo único que escribe en las dos tablas.
 *
 * Dos cosas se prueban acá porque son promesas del diseño, no detalles:
 *
 *   1. **Nunca tira.** El que llama está en el camino de un request que ya
 *      terminó. Si esto propaga un error, es un `unhandledRejection` fuera del
 *      ciclo del request — o sea, romper el proceso por no poder escribir un
 *      renglón de auditoría.
 *   2. **Sanea antes de escribir.** `org_id`, `user_id` y `session_id` son
 *      columnas `uuid`; Postgres rechaza la fila ENTERA si le llega cualquier
 *      otro texto. Y el `cio-org-id` lo manda el cliente.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const insertAuditEvent = vi.fn(async () => true);
const insertAuditIncident = vi.fn(async () => true);
const hasRecentAuditEvent = vi.fn(async () => false);
const purgeAuditBefore = vi.fn(async () => ({ events: 0, incidents: 0 }));

vi.mock('@cio/db/queries/audit', () => ({
  insertAuditEvent: (...args: unknown[]) => insertAuditEvent(...(args as [])),
  insertAuditIncident: (...args: unknown[]) => insertAuditIncident(...(args as [])),
  hasRecentAuditEvent: (...args: unknown[]) => hasRecentAuditEvent(...(args as [])),
  purgeAuditBefore: (...args: unknown[]) => purgeAuditBefore(...(args as []))
}));

const { purgeAudit, recordEvent, recordIncident, toUuid } = await import('@api/services/audit');

const UUID = '3f1c9f2e-8a4b-4c1d-9e7a-2b5d6c8f0a13';
const OTHER_UUID = 'a1b2c3d4-e5f6-4789-8abc-def012345678';

const baseEvent = {
  orgId: UUID,
  userId: OTHER_UUID,
  userLabel: 'ana@egea.com.ar',
  userRole: null,
  orgRole: 1,
  sessionId: null,
  action: 'VIO_SEGUIMIENTO',
  ip: '203.0.113.10',
  device: 'Windows',
  browser: 'Chrome',
  userAgent: 'Mozilla/5.0',
  method: 'GET',
  route: '/organization/tracking/overview',
  status: 200,
  durationMs: 42
};

const rowOf = (spy: typeof insertAuditEvent) => spy.mock.calls[0]![0] as Record<string, unknown>;

beforeEach(() => {
  vi.clearAllMocks();
  // Varios tests recorren a propósito el camino del error, que loguea. Sin esto
  // la salida del suite queda llena de stacks esperados y los reales se pierden.
  vi.spyOn(console, 'error').mockImplementation(() => {});
  hasRecentAuditEvent.mockResolvedValue(false);
  insertAuditEvent.mockResolvedValue(true);
  insertAuditIncident.mockResolvedValue(true);
});

describe('toUuid', () => {
  it('deja pasar un uuid y descarta cualquier otra cosa', () => {
    expect(toUuid(UUID)).toBe(UUID);
    expect(toUuid(` ${UUID} `)).toBe(UUID);
    expect(toUuid('no-soy-un-uuid')).toBeNull();
    expect(toUuid('')).toBeNull();
    expect(toUuid(null)).toBeNull();
    expect(toUuid("' OR 1=1 --")).toBeNull();
  });
});

describe('recordEvent', () => {
  it('escribe la fila con quién, desde dónde y cuánto tardó', async () => {
    await recordEvent(baseEvent);

    expect(insertAuditEvent).toHaveBeenCalledTimes(1);
    expect(rowOf(insertAuditEvent)).toMatchObject({
      orgId: UUID,
      userId: OTHER_UUID,
      userLabel: 'ana@egea.com.ar',
      action: 'VIO_SEGUIMIENTO',
      ip: '203.0.113.10',
      device: 'Windows',
      browser: 'Chrome',
      route: '/organization/tracking/overview',
      status: 200,
      durationMs: 42
    });
  });

  it('convierte a null un orgId que no es uuid en vez de perder la fila', async () => {
    // El `cio-org-id` lo manda el cliente. Sin este saneo, un header con basura
    // hace que Postgres rechace el INSERT y la acción no quede registrada.
    await recordEvent({ ...baseEvent, orgId: 'no-es-uuid', sessionId: 'tampoco' });

    expect(insertAuditEvent).toHaveBeenCalledTimes(1);
    expect(rowOf(insertAuditEvent)).toMatchObject({ orgId: null, sessionId: null, action: 'VIO_SEGUIMIENTO' });
  });

  it('respeta la ventana anti-repetición en las lecturas', async () => {
    hasRecentAuditEvent.mockResolvedValue(true);

    await recordEvent(baseEvent);

    expect(insertAuditEvent).not.toHaveBeenCalled();
  });

  it('no consulta siquiera la ventana cuando la acción es una escritura', async () => {
    // Cada escritura cambió algo distinto: perder la segunda sería perder un
    // hecho, no ahorrar ruido.
    await recordEvent({ ...baseEvent, action: 'EDITO_EMPRESA', method: 'PUT', always: true });

    expect(hasRecentAuditEvent).not.toHaveBeenCalled();
    expect(insertAuditEvent).toHaveBeenCalledTimes(1);
  });

  it('pregunta por la ventana con el id saneado', async () => {
    // Si la consulta buscara por el valor crudo y el INSERT por el saneado,
    // la ventana nunca encontraría nada y no filtraría ninguna repetición.
    await recordEvent({ ...baseEvent, orgId: 'no-es-uuid' });

    expect(hasRecentAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ orgId: null }));
  });

  it('no tira cuando la escritura falla', async () => {
    insertAuditEvent.mockRejectedValue(new Error('la base no está'));

    await expect(recordEvent(baseEvent)).resolves.toBeUndefined();
  });

  it('no tira cuando falla la consulta de la ventana', async () => {
    hasRecentAuditEvent.mockRejectedValue(new Error('timeout'));

    await expect(recordEvent(baseEvent)).resolves.toBeUndefined();
  });
});

describe('recordIncident', () => {
  const baseIncident = {
    kind: 'BACKEND_ERROR' as const,
    source: 'BACKEND' as const,
    message: 'Cannot read properties of undefined',
    status: 500,
    route: '/organization/tracking/overview',
    method: 'GET'
  };

  it('escribe la incidencia con su origen', async () => {
    await recordIncident(baseIncident);

    expect(rowOf(insertAuditIncident)).toMatchObject({
      kind: 'BACKEND_ERROR',
      source: 'BACKEND',
      message: 'Cannot read properties of undefined',
      status: 500
    });
  });

  it('recorta lo que puede venir del cliente', async () => {
    await recordIncident({
      ...baseIncident,
      message: 'm'.repeat(5000),
      stack: 's'.repeat(20000),
      code: 'c'.repeat(500),
      route: `/${'r'.repeat(3000)}`
    });

    const row = rowOf(insertAuditIncident);
    expect((row.message as string).length).toBe(2000);
    expect((row.stack as string).length).toBe(8000);
    expect((row.code as string).length).toBe(100);
    expect((row.route as string).length).toBe(1000);
  });

  it('sanea también los ids de una incidencia reportada por el navegador', async () => {
    await recordIncident({ ...baseIncident, source: 'FRONTEND', orgId: 'javascript:alert(1)' });

    expect(rowOf(insertAuditIncident)).toMatchObject({ orgId: null });
  });

  it('completa con null los campos que no vinieron', async () => {
    await recordIncident({ kind: 'FRONTEND_ERROR', source: 'FRONTEND', message: 'boom' });

    expect(rowOf(insertAuditIncident)).toMatchObject({
      stack: null,
      code: null,
      status: null,
      route: null,
      userId: null,
      metadata: null
    });
  });

  it('no tira cuando la escritura falla', async () => {
    insertAuditIncident.mockRejectedValue(new Error('la tabla no existe'));

    await expect(recordIncident(baseIncident)).resolves.toBeUndefined();
  });
});

describe('purgeAudit', () => {
  it('borra con un corte en el pasado y devuelve las cuentas', async () => {
    purgeAuditBefore.mockResolvedValue({ events: 12, incidents: 3 });

    const result = await purgeAudit();

    expect(result).toEqual({ events: 12, incidents: 3 });

    const cutoff = new Date(purgeAuditBefore.mock.calls[0]![0] as unknown as string);
    expect(cutoff.getTime()).toBeLessThan(Date.now());
    expect(Number.isNaN(cutoff.getTime())).toBe(false);
  });

  it('devuelve null en vez de tirar cuando falla', async () => {
    // La purga corre desde un `setInterval`: un throw sin capturar acá tumba el
    // proceso de la API una vez por día.
    purgeAuditBefore.mockRejectedValue(new Error('deadlock'));

    await expect(purgeAudit()).resolves.toBeNull();
  });
});
