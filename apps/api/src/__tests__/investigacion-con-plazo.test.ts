/**
 * La investigación tiene un plazo de verdad.
 *
 * Medido en producción: la investigación en profundidad normal tardó 32 s y el
 * navegador cortó a los 30 con «Request timeout». El tope del servidor (48 s)
 * no era un techo: sólo impedía EMPEZAR lecturas nuevas, y una lectura colgada
 * estiraba la investigación todo lo que tardara.
 *
 * Lo que se fija:
 *   1. al vencer el plazo se contesta con lo que haya, sin esperar la lectura
 *      colgada, y lo que llega tarde no se guarda;
 *   2. un muro de inicio de sesión que el lector devolvió como página no entra
 *      como fuente (el mismo criterio que la ruta de Fuentes).
 *
 * El reloj es de mentira: 48 s de plazo no se esperan en un test.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const groundedSearch = vi.fn();
const fetchDocumentationUrl = vi.fn();
const storeDraftDocument = vi.fn();
const storeUrlDocument = vi.fn();
const lugarParaFuentes = vi.fn();

vi.mock('@api/services/agent/web-search', async () => {
  const actual = await vi.importActual<typeof import('@api/services/agent/web-search')>(
    '@api/services/agent/web-search'
  );

  return { ...actual, groundedSearch: (...args: unknown[]) => groundedSearch(...args) };
});

vi.mock('@api/services/agent/fetch-url', () => ({
  fetchDocumentationUrl: (...args: unknown[]) => fetchDocumentationUrl(...args)
}));

vi.mock('@api/services/agent/document', () => ({
  URL_SOURCE_MIME_TYPE: 'text/markdown',
  storeDraftDocument: (...args: unknown[]) => storeDraftDocument(...args),
  storeUrlDocument: (...args: unknown[]) => storeUrlDocument(...args),
  // El tope de fuentes del curso: lugar de sobra salvo que el test diga otra cosa.
  lugarParaFuentes: (...args: unknown[]) => lugarParaFuentes(...args),
  errorDeTopeDeFuentes: () => Object.assign(new Error('This course already has 100 sources'), { code: 'SOURCE_LIMIT_REACHED', statusCode: 422 }),
  esTopeDeFuentes: (error: unknown) => (error as { code?: string } | null)?.code === 'SOURCE_LIMIT_REACHED'
}));

vi.mock('@api/config/env', () => ({ env: { JINA_API_KEY: 'key' } }));

vi.mock('@api/utils/redis/redis', () => ({
  redis: { isOpen: false, get: vi.fn(), set: vi.fn() },
  logRedisUnavailableOnce: vi.fn()
}));

const { runResearch } = await import('@api/services/agent/research');

const BASE = { orgId: 'org-demo', userId: 'docente-demo', redis: {} as never };

const ARTICULO = [
  'Title: Arqueo de caja',
  '',
  'Markdown Content:',
  'El arqueo compara el efectivo contado con lo que registró el sistema durante el turno.',
  'Se hace al cerrar la caja, con el reporte del sistema impreso y el efectivo separado por denominación.',
  'Cada diferencia se anota con su explicación antes de firmar la planilla de cierre del turno.',
  'Si la diferencia supera el tope que fija la empresa, se avisa al encargado antes de retirarse.',
  'El reporte firmado se guarda junto con los comprobantes de los retiros parciales del día.'
].join('\n');

const MURO = [
  'Title: Sign in - Cuentas de Ejemplo',
  '',
  'Markdown Content:',
  '# Sign in',
  'to continue to Ejemplo Docs',
  'Email or phone',
  'Forgot email?',
  ...['Afrikaans', 'Dansk', 'Deutsch', 'Español', 'Français', 'Italiano', 'Nederlands', 'Polski', 'Português', 'Svenska'].map(
    (idioma) => `*   ${idioma}`
  ),
  ...Array.from({ length: 40 }, (_, i) => `*   Idioma de relleno número ${i + 1}`)
].join('\n');

function pagina(url: string, content = ARTICULO) {
  return { url, pageTitle: `Título de ${url}`, content, links: [], contentTokens: 10, fetchedAt: '', cacheHit: false };
}

function encontradas(urls: string[]) {
  return { queries: ['arqueo de caja'], results: urls.map((url) => ({ url, title: url, snippet: '' })) };
}

beforeEach(() => {
  vi.clearAllMocks();
  lugarParaFuentes.mockResolvedValue(100);
  storeDraftDocument.mockImplementation(async () => ({ documentId: `borrador-${storeDraftDocument.mock.calls.length}` }));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('el plazo de la investigación', () => {
  it('al vencer contesta con lo que hay, sin esperar la lectura colgada', async () => {
    vi.useFakeTimers();

    groundedSearch.mockResolvedValue(encontradas(['https://buena.ejemplo.test/1', 'https://colgada.ejemplo.test/1']));

    let soltarLaColgada!: (valor: unknown) => void;
    fetchDocumentationUrl.mockImplementation(({ url }: { url: string }) =>
      url.includes('colgada')
        ? new Promise((resolver) => {
            soltarLaColgada = resolver;
          })
        : Promise.resolve(pagina(url))
    );

    let terminada = false;
    const investigacion = runResearch({ ...BASE, topic: 'arqueo de caja', depth: 'quick' }).then((resultado) => {
      terminada = true;
      return resultado;
    });

    // Antes del plazo sigue esperando: la colgada todavía podría llegar.
    await vi.advanceTimersByTimeAsync(40_000);
    expect(terminada).toBe(false);

    // Al vencer contesta, con la que sí se leyó.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(terminada).toBe(true);

    const resultado = await investigacion;
    expect(resultado.sources.map((fuente) => fuente.url)).toEqual(['https://buena.ejemplo.test/1']);

    // Lo que llega tarde no se guarda: la docente ya recibió la lista.
    soltarLaColgada(pagina('https://colgada.ejemplo.test/1'));
    await vi.advanceTimersByTimeAsync(100);
    expect(storeDraftDocument).toHaveBeenCalledTimes(1);
  });
});

describe('lo que la investigación no guarda', () => {
  it('un muro de inicio de sesión devuelto como página no entra como fuente', async () => {
    // Trae la lista de idiomas como texto plano: el filtro viejo, que medía
    // sólo el texto fuera de los enlaces, lo dejaba pasar.
    groundedSearch.mockResolvedValue(encontradas(['https://docs.ejemplo.test/d/1', 'https://buena.ejemplo.test/2']));
    fetchDocumentationUrl.mockImplementation(async ({ url }: { url: string }) =>
      pagina(url, url.includes('docs.ejemplo') ? MURO : ARTICULO)
    );

    const resultado = await runResearch({ ...BASE, topic: 'arqueo de caja', depth: 'quick' });

    expect(resultado.sources.map((fuente) => fuente.url)).toEqual(['https://buena.ejemplo.test/2']);
    expect(resultado.failedCount).toBe(1);
    expect(storeDraftDocument).toHaveBeenCalledTimes(1);
  });
});
