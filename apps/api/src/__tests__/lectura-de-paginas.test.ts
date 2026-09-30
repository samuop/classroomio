/**
 * La lectura de una página: qué se guarda, cuánto, y cuándo se vuelve a leer.
 *
 * Tres agujeros medidos en producción, uno por bloque:
 *
 *   1. La caché guardaba 7 días CUALQUIER 200 del lector, también la pantalla de
 *      inicio de sesión de una planilla privada. La docente compartía la
 *      planilla, la volvía a agregar y le volvía el mismo muro desde la caché.
 *   2. Agregar una página a mano leía de esa caché: no había forma de pedir lo
 *      que la página dice HOY.
 *   3. La lectura no tenía plazo. Una página colgada colgaba la investigación
 *      entera, y el navegador se iba a los 30 s con «Request timeout».
 *
 * Todo contra `fetchDocumentationUrl` de verdad: sólo son de mentira la red (el
 * lector) y Redis.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** Redis de mentira que recuerda qué se guardó y por cuánto. */
const guardado = new Map<string, { valor: string; ttl: number }>();

vi.mock('@api/utils/redis/redis', () => ({
  redis: {
    isOpen: true,
    get: vi.fn(async (clave: string) => guardado.get(clave)?.valor ?? null),
    set: vi.fn(async (clave: string, valor: string, opciones?: { EX?: number }) => {
      guardado.set(clave, { valor, ttl: opciones?.EX ?? 0 });
      return 'OK';
    })
  },
  logRedisUnavailableOnce: vi.fn()
}));

const { fetchDocumentationUrl, PLAZO_DE_LECTURA_MS } = await import('@api/services/agent/fetch-url');
const { AppError } = await import('@api/utils/errors');

const SIETE_DIAS = 7 * 24 * 3600;
const DIEZ_MINUTOS = 10 * 60;

const PLANILLA = 'https://docs.google.com/spreadsheets/d/1EjemploInventadoDePlanilla000000000000000/edit';
const ARTICULO = 'https://ayuda.ejemplo.test/articulos/conciliacion';

const MURO = [
  'Title: Google Sheets: Sign-in',
  '',
  `URL Source: ${PLANILLA}`,
  '',
  'Markdown Content:',
  '# Sign in',
  'to continue to Google Sheets',
  'Email or phone',
  'Forgot email?',
  'Next',
  'Create account',
  ...['Afrikaans', 'Dansk', 'Deutsch', 'Español', 'Français', 'Italiano', 'Polski', 'Svenska'].map((i) => `*   ${i}`)
].join('\n');

function articulo(version: string): string {
  return [
    'Title: Conciliación bancaria',
    '',
    `URL Source: ${ARTICULO}`,
    '',
    'Markdown Content:',
    '# Conciliación bancaria',
    `La conciliación compara cada mes los movimientos del banco con los registros de la empresa (${version}).`,
    'Sirve para encontrar a tiempo los errores de carga y los débitos que nadie reconoce en el resumen.'
  ].join('\n');
}

/** El lector contesta 200 con este texto, como hace aunque no haya podido leer nada. */
function lectorQueDevuelve(texto: string) {
  return vi.fn(async (_url: string, _init?: RequestInit) => new Response(texto, { status: 200 }));
}

function leer(url: string, extra: { fresco?: boolean; plazoMs?: number } = {}) {
  return fetchDocumentationUrl({ url, orgId: 'org-demo', courseId: 'curso-demo', priorMessages: [], ...extra });
}

beforeEach(() => {
  guardado.clear();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('qué guarda la caché', () => {
  it('un muro de inicio de sesión se rechaza con 422, y se guarda sólo diez minutos', async () => {
    vi.stubGlobal('fetch', lectorQueDevuelve(MURO));

    const error = await leer(PLANILLA).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AppError);
    expect((error as InstanceType<typeof AppError>).statusCode).toBe(422);
    expect((error as InstanceType<typeof AppError>).code).toBe('SOURCE_NEEDS_LOGIN');

    const [entrada] = [...guardado.values()];
    expect(entrada.ttl).toBe(DIEZ_MINUTOS);
  });

  it('una página de verdad se guarda los 7 días de siempre', async () => {
    vi.stubGlobal('fetch', lectorQueDevuelve(articulo('v1')));

    const pagina = await leer(ARTICULO);

    expect(pagina.content).toContain('conciliación compara');
    expect([...guardado.values()][0].ttl).toBe(SIETE_DIAS);
  });

  it('un muro guardado de antes, con sus 7 días, tampoco pasa', async () => {
    // Las entradas escritas antes del detector siguen ahí hasta que vencen.
    vi.stubGlobal('fetch', lectorQueDevuelve(MURO));
    await leer(PLANILLA).catch(() => undefined);
    const [clave] = [...guardado.keys()];
    guardado.set(clave, { ...guardado.get(clave)!, ttl: SIETE_DIAS });

    const lector = lectorQueDevuelve(articulo('no debería leerse'));
    vi.stubGlobal('fetch', lector);

    await expect(leer(PLANILLA)).rejects.toMatchObject({ code: 'SOURCE_NEEDS_LOGIN' });
    expect(lector).not.toHaveBeenCalled();
  });
});

describe('la lectura fresca', () => {
  it('sin pedirla, lo guardado se devuelve sin volver a leer', async () => {
    vi.stubGlobal('fetch', lectorQueDevuelve(articulo('v1')));
    await leer(ARTICULO);

    const lector = lectorQueDevuelve(articulo('v2'));
    vi.stubGlobal('fetch', lector);

    const pagina = await leer(ARTICULO);

    expect(pagina.cacheHit).toBe(true);
    expect(pagina.content).toContain('(v1)');
    expect(lector).not.toHaveBeenCalled();
  });

  it('pedida, saltea la caché, le pide lo mismo al lector y deja guardada la lectura nueva', async () => {
    vi.stubGlobal('fetch', lectorQueDevuelve(articulo('v1')));
    await leer(ARTICULO);

    const lector = lectorQueDevuelve(articulo('v2'));
    vi.stubGlobal('fetch', lector);

    const fresca = await leer(ARTICULO, { fresco: true });

    expect(fresca.cacheHit).toBe(false);
    expect(fresca.content).toContain('(v2)');
    // El lector también guarda copias: una lectura fresca que le pidiera la suya
    // devolvería el mismo muro que la docente acaba de destrabar.
    expect((lector.mock.calls[0][1]?.headers as Record<string, string>)['X-No-Cache']).toBe('true');

    const despues = await leer(ARTICULO);
    expect(despues.cacheHit).toBe(true);
    expect(despues.content).toContain('(v2)');
  });

  it('la planilla recién compartida se lee de nuevo aunque el muro siga guardado', async () => {
    vi.stubGlobal('fetch', lectorQueDevuelve(MURO));
    await leer(PLANILLA).catch(() => undefined);

    vi.stubGlobal('fetch', lectorQueDevuelve(articulo('compartida')));

    const pagina = await leer(PLANILLA, { fresco: true });

    expect(pagina.content).toContain('(compartida)');
  });
});

describe('el plazo de una lectura', () => {
  it('una lectura colgada se corta y lo dice, en vez de esperar para siempre', async () => {
    // Un lector que no contesta nunca: sólo la señal de plazo lo destraba.
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
          })
      )
    );

    const inicio = Date.now();
    const error = await leer(ARTICULO, { plazoMs: 40 }).catch((e: unknown) => e);

    expect(error).toMatchObject({ code: 'DOCUMENTATION_FETCH_TIMEOUT', statusCode: 504 });
    expect(Date.now() - inicio).toBeLessThan(2_000);
  });

  it('por defecto el plazo es de 15 s', async () => {
    const plazo = vi.spyOn(AbortSignal, 'timeout');
    vi.stubGlobal('fetch', lectorQueDevuelve(articulo('v1')));

    await leer(ARTICULO);

    expect(PLAZO_DE_LECTURA_MS).toBe(15_000);
    expect(plazo).toHaveBeenCalledWith(PLAZO_DE_LECTURA_MS);
  });
});
