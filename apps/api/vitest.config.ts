import { configDefaults, defineConfig } from 'vitest/config';

import { INTEGRATION_TESTS, testAlias } from './vitest.shared';

export default defineConfig({
  resolve: {
    alias: testAlias
  },
  test: {
    globals: true,
    environment: 'node',
    // `NODE_ENV=test` va aca y no en el guion de npm: en el guion estaba escrito
    // como `vitest NODE_ENV=test`, donde vitest lo tomaba como un FILTRO de
    // nombres de archivo. No coincidia con ninguno, asi que `pnpm test` no
    // corria un solo test y salia con codigo 1. Aca ademas funciona en Windows.
    env: { NODE_ENV: 'test' },
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
