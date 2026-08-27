import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Quién dibuja los PDF.
 *
 * Hay dos motores y son el mismo Chromium; lo que este archivo fija es la
 * ELECCIÓN, porque equivocarse ahí no rompe nada visible: se sigue generando un
 * archivo, sólo que por el camino que no queríamos —y en el caso de Cloudflare,
 * uno que no alcanza nuestras imágenes ni funciona sin credenciales.
 */

const original = process.env.CERTIFICATE_RENDERER;

afterEach(() => {
  if (original === undefined) delete process.env.CERTIFICATE_RENDERER;
  else process.env.CERTIFICATE_RENDERER = original;

  vi.resetModules();
});

async function cargar() {
  vi.resetModules();

  return import('@api/utils/render');
}

describe('elección de motor', () => {
  it('sin configurar nada usa el navegador propio', async () => {
    delete process.env.CERTIFICATE_RENDERER;
    const { activeRenderEngine } = await cargar();

    expect(activeRenderEngine()).toBe('chromium');
  });

  it('`cloudflare` es la salida de emergencia y hay que pedirla', async () => {
    process.env.CERTIFICATE_RENDERER = 'cloudflare';
    const { activeRenderEngine } = await cargar();

    expect(activeRenderEngine()).toBe('cloudflare');
  });

  it('tolera espacios y mayúsculas', async () => {
    process.env.CERTIFICATE_RENDERER = '  CloudFlare  ';
    const { activeRenderEngine } = await cargar();

    expect(activeRenderEngine()).toBe('cloudflare');
  });

  it('un valor mal escrito cae al motor QUE FUNCIONA, no al que puede faltar', async () => {
    // La dirección importa. Cayendo a Cloudflare, una variable con un dedazo
    // apagaría la exportación entera en un despliegue sin credenciales — que es
    // exactamente el modo de falla que este cambio viene a eliminar.
    process.env.CERTIFICATE_RENDERER = 'cloudflarr';
    const { activeRenderEngine } = await cargar();

    expect(activeRenderEngine()).toBe('chromium');
  });
});

describe('si este despliegue puede exportar', () => {
  it('con el navegador propio, siempre: viaja con el código', async () => {
    delete process.env.CERTIFICATE_RENDERER;
    const { isRenderConfigured } = await cargar();

    expect(isRenderConfigured()).toBe(true);
  });

  it('con Cloudflare depende de las credenciales', async () => {
    // El caso que dejó la exportación rota en producción durante meses: sin
    // estas dos variables la llamada sale como `/accounts/undefined/…` y vuelve
    // un 404 que se lee como una función rota y no como una sin configurar.
    process.env.CERTIFICATE_RENDERER = 'cloudflare';
    vi.resetModules();
    vi.doMock('@api/constants', () => ({ CLOUDFLARE: { CONFIGS: { ACCOUNT_ID: '', RENDERING_API_KEY: '' } } }));

    const { isRenderConfigured } = await import('@api/utils/render');

    expect(isRenderConfigured()).toBe(false);

    vi.doUnmock('@api/constants');
  });
});
