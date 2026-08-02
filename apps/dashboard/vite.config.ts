import { defineConfig, loadEnv } from 'vite';
import fs from 'fs';
import { sveltekit } from '@sveltejs/kit/vite';

export default ({ mode }) => {
  process.env = { ...process.env, ...loadEnv(mode, process.cwd()) };

  return defineConfig({
    css: {
      preprocessorOptions: {
        scss: {
          silenceDeprecations: ['legacy-js-api']
        }
      }
    },
    plugins: [sveltekit()],
    // Expose PUBLIC_* env vars on `import.meta.env` in the client bundle. Vite's
    // default envPrefix is only `VITE_`, so without this `@cio/utils` (which reads
    // import.meta.env.PUBLIC_TENANT_ROOT_DOMAIN / _BRAND_ROOT_DOMAIN) would never
    // see them in the browser and fall back to the cloud default. SvelteKit's
    // PUBLIC_ prefix only feeds `$env/static/public`, not import.meta.env, so this
    // must be set explicitly. VITE_ stays included so existing VITE_* vars work.
    envPrefix: ['VITE_', 'PUBLIC_'],
    server: {
      ...getServer(process.env),
      watch: {
        ignored: ['**/node_modules/!(@cio)/**', '**/.git/**']
      }
    },
    build: {
      sourcemap: false
    },
    ssr: {
      // svelte-motion uses directory imports without `/index.js`; Node ESM fails unless bundled for SSR.
      // `layerchart` ships as ESM but its files are pre-compiled `.svelte.js`
      // (with `<script>` blocks already inlined as plain JS). Bundling it for
      // SSR is fine — its self-referencing cycle between TransformContext and
      // Chart was fixed in 2.0.0 by extracting the chart context into
      // `dist/contexts/chart.js`.
      //
      // `@dagrejs/dagre` is **CommonJS only** (`module.exports = {...}`, no ESM
      // build). layerchart imports it via `import dagre from '@dagrejs/dagre'`
      // in `dist/utils/graph/dagre.js`, which Vite SSR cannot serve as ESM.
      // We include it in `noExternal` so Vite bundles it for SSR (giving the
      // dependency the same CJS→ESM shim treatment used in the client
      // pre-bundle). Same treatment for `d3-interpolate-path`, which is also
      // CJS-only and used by `Spline.svelte`.
      noExternal: [
        'svelte-sonner',
        'layerchart',
        'svelte-toolbelt',
        'tldts',
        'tldts-core',
        'svelte-motion',
        'svelte-inview',
        '@dagrejs/dagre',
        'd3-interpolate-path'
      ]
    },
    optimizeDeps: {
      entries: ['src/routes/**/+*.{js,ts,svelte}'],
      // Only direct workspace deps go in `include`. The CJS deps of
      // layerchart (`@dagrejs/dagre`, `d3-interpolate-path`) are transitive
      // — pnpm only symlinks direct deps into `node_modules/`, so Vite
      // can't resolve them as bare specifiers here. They are still handled
      // correctly via `ssr.noExternal` (which walks the import graph from
      // layerchart) and via the client-side pre-bundle triggered by
      // layerchart's own `import` statements.
      include: ['@cio/api/rpc-types'],
      // Workspace packages must be processed by Svelte/Vite (not pre-bundled)
      // so HMR fires when editing files under packages/*.
      exclude: ['@cio/ui', '@cio/utils', '@cio/question-types']
    },
    resolve: {
      mainFields: ['browser']
    }
  });
};

function getServer(params) {
  const { VITE_USE_HTTPS_ON_LOCALHOST } = params || {};
  if (VITE_USE_HTTPS_ON_LOCALHOST === 'true') {
    return {
      https: {
        key: fs.readFileSync(`${__dirname}/cert/key.pem`),
        cert: fs.readFileSync(`${__dirname}/cert/cert.pem`)
      }
    };
  }

  return {
    allowedHosts: []
  };
}

// function getSentryConfig(params: any) {
//   const { VITE_SENTRY_AUTH_TOKEN, VITE_SENTRY_ORG_NAME, VITE_SENTRY_PROJECT_NAME } = params || {};
//   if (VITE_SENTRY_AUTH_TOKEN === 'true') {
//     return {
//       url: 'https://sentry.io',
//       authToken: VITE_SENTRY_AUTH_TOKEN,
//       org: VITE_SENTRY_ORG_NAME,
//       project: VITE_SENTRY_PROJECT_NAME,
//       options: {
//         telemetry: false,
//       }
//     };
//   }
//   return {};
// }
