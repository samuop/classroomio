import { defineConfig } from 'vitest/config';

import { INTEGRATION_TESTS, testAlias } from './vitest.shared';

/**
 * Tests de integración: los que necesitan un Postgres de verdad.
 *
 * Se corren con `pnpm test:db` y NO entran en `pnpm test`, que tiene que seguir
 * pasando en una máquina sin Docker.
 *
 * Levantar la base: `docker compose -f docker/docker-compose.yaml up -d postgres`
 * y `pnpm --filter @cio/db db:setup`. El `DATABASE_URL` sale de `apps/api/.env`,
 * que `@cio/db` carga solo con dotenv.
 */
export default defineConfig({
  resolve: {
    alias: testAlias
  },
  test: {
    globals: true,
    environment: 'node',
    include: [INTEGRATION_TESTS],
    // Una sola base compartida: en paralelo, dos archivos se pisarían las filas
    // y la purga de uno se llevaría lo que el otro estaba por leer.
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 20000
  }
});
