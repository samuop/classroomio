/**
 * La purga diaria del registro.
 *
 * Es poco código pero corre desde un `setInterval` dentro del proceso de la API,
 * y eso le impone tres condiciones que no se ven mirando el archivo:
 *
 *   - **No puede arrancar dos veces.** Un segundo intervalo duplicaría el DELETE
 *     y, peor, quedaría sin referencia para poder frenarlo.
 *   - **No puede tirar.** Un throw dentro del callback de un `setInterval` no lo
 *     atrapa nadie: tumba el proceso, una vez por día.
 *   - **Tiene que poder apagarse sin tocar código**, para el día que haga falta
 *     conservar más historia de la que dice la retención.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const purgeAudit = vi.fn(async () => ({ events: 0, incidents: 0 }));

vi.mock('@api/services/audit', () => ({
  purgeAudit: () => purgeAudit(),
  AUDIT_RETENTION_DAYS: 365
}));

const { startAuditPurge, stopAuditPurge } = await import('@api/utils/audit-purge');

/**
 * Deja correr la cola de microtareas que dispara cada tick.
 *
 * `setImmediate` queda FUERA de los timers falsos (ver `toFake` abajo): si se
 * falseara, esta promesa no resolvería nunca y todos los tests morirían por
 * timeout en vez de por lo que están probando.
 */
const flush = () => new Promise((resolve) => setImmediate(resolve));

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  vi.spyOn(console, 'log').mockImplementation(() => {});
  // El test del rechazo recorre el camino del error a propósito, que loguea.
  vi.spyOn(console, 'error').mockImplementation(() => {});
  delete process.env.AUDIT_PURGE_DISABLED;
});

afterEach(() => {
  stopAuditPurge();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('startAuditPurge', () => {
  it('no purga apenas arranca', async () => {
    // Al levantar el proceso hay cosas más urgentes (conectar Redis, precargar
    // dominios, atender requests) que un DELETE masivo.
    startAuditPurge();
    await flush();

    expect(purgeAudit).not.toHaveBeenCalled();

    vi.advanceTimersByTime(5 * 60 * 1000);
    await flush();

    expect(purgeAudit).toHaveBeenCalledTimes(1);
  });

  it('sigue purgando una vez por día', async () => {
    startAuditPurge();

    vi.advanceTimersByTime(5 * 60 * 1000);
    await flush();
    expect(purgeAudit).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(24 * 60 * 60 * 1000);
    await flush();
    expect(purgeAudit).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(24 * 60 * 60 * 1000);
    await flush();
    expect(purgeAudit).toHaveBeenCalledTimes(3);
  });

  it('acepta un intervalo propio, para poder probarla', async () => {
    startAuditPurge(1000);

    vi.advanceTimersByTime(5 * 60 * 1000 + 3000);
    await flush();

    expect(purgeAudit.mock.calls.length).toBeGreaterThan(1);
  });

  it('no arranca dos veces', async () => {
    startAuditPurge();
    startAuditPurge();
    startAuditPurge();

    vi.advanceTimersByTime(5 * 60 * 1000 + 24 * 60 * 60 * 1000);
    await flush();

    // Una por la demora inicial y una por el primer día. Si el segundo
    // `startAuditPurge` hubiera montado su propio intervalo, serían cuatro.
    expect(purgeAudit).toHaveBeenCalledTimes(2);
  });

  it('se puede apagar con una variable de entorno', async () => {
    process.env.AUDIT_PURGE_DISABLED = '1';
    // La perilla se lee de `env`, que se congela al importar el módulo de
    // configuración; por eso se vuelve a importar con la variable ya puesta.
    vi.resetModules();
    const fresh = await import('@api/utils/audit-purge');

    fresh.startAuditPurge();
    vi.advanceTimersByTime(48 * 60 * 60 * 1000);
    await flush();

    expect(purgeAudit).not.toHaveBeenCalled();
    fresh.stopAuditPurge();
  });

  it('no tumba el proceso si la purga falla', async () => {
    // `purgeAudit` ya traga sus errores, pero si alguna vez dejara de hacerlo,
    // el throw saldría por el callback del intervalo, donde no lo atrapa nadie.
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    purgeAudit.mockRejectedValue(new Error('deadlock'));

    startAuditPurge();
    vi.advanceTimersByTime(5 * 60 * 1000);
    await flush();
    await flush();

    process.off('unhandledRejection', unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });
});

describe('stopAuditPurge', () => {
  it('frena el intervalo', async () => {
    startAuditPurge();
    vi.advanceTimersByTime(5 * 60 * 1000);
    await flush();
    expect(purgeAudit).toHaveBeenCalledTimes(1);

    stopAuditPurge();
    vi.advanceTimersByTime(72 * 60 * 60 * 1000);
    await flush();

    expect(purgeAudit).toHaveBeenCalledTimes(1);
  });

  it('se puede llamar sin haber arrancado', () => {
    expect(() => stopAuditPurge()).not.toThrow();
  });

  it('deja el arranque disponible de nuevo', async () => {
    startAuditPurge();
    stopAuditPurge();
    startAuditPurge();

    vi.advanceTimersByTime(5 * 60 * 1000);
    await flush();

    expect(purgeAudit).toHaveBeenCalledTimes(1);
  });
});
