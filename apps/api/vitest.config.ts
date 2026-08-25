import { configDefaults, defineConfig } from 'vitest/config';

import { INTEGRATION_TESTS, testAlias } from './vitest.shared';

export default defineConfig({
  resolve: {
    alias: testAlias
  },
  test: {
    globals: true,
    environment: 'node',
    // Los `.int.test.ts` necesitan un Postgres levantado, así que quedan afuera
    // de la corrida normal: `pnpm test` tiene que pasar en una máquina sin
    // Docker. Se corren aparte con `pnpm test:db`.
    exclude: [...configDefaults.exclude, INTEGRATION_TESTS],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'dist/']
    }
  }
});
