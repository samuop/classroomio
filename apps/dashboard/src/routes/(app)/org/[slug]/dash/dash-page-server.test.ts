import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * El cargador del panel de la empresa.
 *
 * Del 2026-08-18 al 2026-09-28 el panel de TODAS las empresas mostró ceros: le
 * pedía las cifras a la API por nombre de sitio, la API exige el id y respondía
 * 400, y el cargador guardaba ese fracaso sin vencimiento hasta el próximo
 * reinicio. Estos tests fijan las tres cosas.
 */

const statsGet = vi.fn();
const loginActivityGet = vi.fn();

vi.mock('$lib/utils/services/api', () => ({
  classroomio: {
    dash: {
      stats: { $get: (...args: unknown[]) => statsGet(...args) },
      'login-activity': { $get: (...args: unknown[]) => loginActivityGet(...args) }
    }
  },
  getApiHeaders: () => ({ headers: {} })
}));

vi.mock('$lib/utils/services/api/server', () => ({
  safeServerApi: async (fn: () => Promise<{ ok: boolean; status: number; body?: unknown; message?: string }>) =>
    fn()
}));

const CIFRAS = { totalCertificates: 2, numberOfCourses: 2, totalStudents: 8, topCourses: [], recentCertifications: [] };
const bien = () => Promise.resolve({ ok: true, status: 200, body: { success: true, data: CIFRAS } });
const mal = () => Promise.resolve({ ok: false, status: 400, message: 'An organization id is required' });

async function cargar() {
  const { load } = await import('./+page.server');
  return load({
    params: { slug: 'cliente-norte' },
    parent: async () => ({ orgId: 'org-1' }),
    cookies: {}
  } as never) as Promise<{ stats: unknown }>;
}

beforeEach(() => {
  vi.resetModules();
  statsGet.mockReset();
  loginActivityGet.mockReset();
  loginActivityGet.mockImplementation(() => Promise.resolve({ ok: true, status: 200, body: { data: [] } }));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('el panel de la empresa', () => {
  it('pide las cifras nombrando la empresa por su id', async () => {
    statsGet.mockImplementation(bien);

    const data = await cargar();

    expect(statsGet).toHaveBeenCalledTimes(1);
    expect(statsGet.mock.calls[0][0]).toEqual({ query: { orgId: 'org-1' } });
    expect(data.stats).toEqual(CIFRAS);
  });

  it('no guarda un pedido fallido: la próxima visita vuelve a pedir', async () => {
    const { load } = await import('./+page.server');
    const evento = { params: { slug: 'cliente-norte' }, parent: async () => ({ orgId: 'org-1' }), cookies: {} } as never;

    statsGet.mockImplementationOnce(mal).mockImplementationOnce(bien);

    expect(((await load(evento)) as { stats: unknown }).stats).toBeNull();
    expect(((await load(evento)) as { stats: unknown }).stats).toEqual(CIFRAS);
    expect(statsGet).toHaveBeenCalledTimes(2);
  });

  it('guarda las cifras un minuto y después las vuelve a pedir', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-28T17:00:00Z'));
    const { load } = await import('./+page.server');
    const evento = { params: { slug: 'cliente-norte' }, parent: async () => ({ orgId: 'org-1' }), cookies: {} } as never;
    statsGet.mockImplementation(bien);

    await load(evento);
    vi.setSystemTime(new Date('2026-09-28T17:00:30Z'));
    await load(evento);
    expect(statsGet).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date('2026-09-28T17:01:31Z'));
    await load(evento);
    expect(statsGet).toHaveBeenCalledTimes(2);
  });
});
