import 'dotenv/config';

import adapterNode from '@sveltejs/adapter-node';
import { getCspDomains } from './src/lib/utils/csp-domains.js';
import path from 'path';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

const IS_CLOUDFLARE = process.env.CI_ENVIRONMENT === 'cloudflare';

const adapterCloudflare = IS_CLOUDFLARE ? (await import('@sveltejs/adapter-cloudflare')).default : null;
const isSelfHosted = process.env.PUBLIC_IS_SELFHOSTED === 'true';
const csp = getCspDomains(isSelfHosted, process.env.PUBLIC_SERVER_URL, process.env.PUBLIC_MEDIA_HOST);

// In dev, Vite injects inline event handlers (onload="this.__e=event") on
// module preloads which a nonce-based CSP blocks, breaking hydration. Allow
// inline scripts only in dev; production keeps the strict policy.
const isDev = process.env.NODE_ENV !== 'production';
const devScriptSrc = isDev ? ['unsafe-inline'] : [];
// The object-storage origin comes from PUBLIC_MEDIA_HOST alone (csp.mediaSrc) — set it
// per environment (http://localhost:9000 for local MinIO, the storage domain in prod).
// It is deliberately NOT gated on NODE_ENV: svelte.config.js is evaluated before Vite
// normalizes NODE_ENV, so a polluted env silently dropped localhost:9000 from img-src
// and every uploaded image rendered as "Failed to load" with no CSP error in the logs.
// connect-src picks the same origin up via csp.connectSrc, and the API origin via
// csp.apiOrigin (PUBLIC_SERVER_URL), so neither needs a hardcoded localhost entry.

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: [vitePreprocess({})],
  kit: {
    // Default: Node server (Render, Docker). Opt into Cloudflare Pages only when CI_ENVIRONMENT=cloudflare.
    adapter: IS_CLOUDFLARE ? adapterCloudflare() : adapterNode(),
    /**
     * Avisar al navegador que se desplegó una versión nueva.
     *
     * SvelteKit le pone un hash al nombre de cada trozo de código. Un deploy los
     * reemplaza, así que quien tenía la aplicación abierta queda con nombres de
     * archivo que ya no existen: al ir a otra pantalla, el trozo no se puede
     * bajar y se rompe con "Failed to fetch dynamically imported module". Pasó en
     * producción el 2026-09-02 con una clienta usando la plataforma.
     *
     * Con esto SvelteKit pregunta cada 5 minutos si cambió la versión, y el
     * guardia de `+layout.svelte` convierte la próxima navegación en una recarga
     * entera. 5 minutos es a propósito: es un pedido diminuto a un JSON, y de
     * nada sirve enterarse una hora después de que la pantalla ya se rompió.
     */
    version: {
      pollInterval: 5 * 60 * 1000
    },
    alias: {
      $lib: path.resolve('./src/lib'),
      $features: path.resolve('./src/lib/features'),
      $mail: path.resolve('./src/mail'),
      '$src/tools': path.resolve('./node_modules/@cio/ui/src/tools/index.ts'),
      '$src/base/*': path.resolve('./node_modules/@cio/ui/src/base/*'),
      '@cio/ui': path.resolve('./node_modules/@cio/ui/src'),
      '@cio/ui/*': path.resolve('./node_modules/@cio/ui/src/*'),
      '@cio/api': path.resolve('./node_modules/@cio/api/dist'),
      '@cio/api/*': path.resolve('./node_modules/@cio/api/dist/*'),
      '@cio/utils': path.resolve('./node_modules/@cio/utils/dist'),
      '@cio/utils/*': path.resolve('./node_modules/@cio/utils/dist/*'),
      '@cio/db/types': path.resolve('./node_modules/@cio/db/src/types.ts')
    },
    csp: {
      mode: 'auto',
      directives: {
        'default-src': ['self'],
        'script-src': ['self', ...csp.scriptSrc, ...devScriptSrc, 'unsafe-hashes', 'unsafe-eval'],
        'style-src': ['self', 'unsafe-inline', ...csp.styleSrc],
        'style-src-elem': ['self', 'unsafe-inline', ...csp.styleSrc],
        'font-src': ['self', ...csp.fontSrc],
        'img-src': ['self', 'data:', ...csp.mediaSrc, 'blob:'],
        'media-src': ['self', ...csp.mediaSrc, 'data:', 'blob:'],
        'frame-src': ['self', ...csp.frameSrc],
        'connect-src': ['self', 'blob:', ...(csp.apiOrigin ? [csp.apiOrigin] : []), ...csp.connectSrc],
        'worker-src': ['self', 'blob:'],
        'object-src': ['none'],
        'base-uri': ['self'],
        'form-action': ['self'],
        // 'self' allows same-origin iframes (e.g. widget preview at /widget-preview). 'none' blocks all embedding.
        'frame-ancestors': ['self'],
        'upgrade-insecure-requests': true
      },
      reportOnly: {
        'default-src': ['self'],
        'script-src': ['self', ...csp.scriptSrc, 'unsafe-hashes', 'unsafe-eval'],
        'style-src': ['self', 'unsafe-inline', ...csp.styleSrc],
        'style-src-elem': ['self', 'unsafe-inline', ...csp.styleSrc],
        'font-src': ['self', ...csp.fontSrc],
        'img-src': ['self', 'data:', ...csp.mediaSrc, 'blob:'],
        'media-src': ['self', ...csp.mediaSrc, 'data:', 'blob:'],
        'frame-src': ['self', ...csp.frameSrc],
        'connect-src': ['self', 'blob:', ...(csp.apiOrigin ? [csp.apiOrigin] : []), ...csp.connectSrc],
        'worker-src': ['self', 'blob:'],
        'object-src': ['none'],
        'base-uri': ['self'],
        'form-action': ['self'],
        'frame-ancestors': ['self'],
        'report-uri': ['/csp-report']
      }
    }
  }
};

export default config;
