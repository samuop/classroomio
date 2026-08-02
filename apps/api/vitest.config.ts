import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@api': path.resolve(__dirname, 'src'),
      // Vite does not follow the `./queries/*` subpath pattern in @cio/db's
      // exports map, so any suite that transitively imported
      // `@cio/db/queries/...` failed to collect at all — ai-credits-usage.test.ts
      // has been red for that reason alone. Pointing at the built output lets
      // vite resolve the subpath as a plain directory (…/queries/agent/index.js).
      '@cio/db': path.resolve(__dirname, '../../packages/db/dist')
    }
  },
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'dist/']
    }
  }
});
