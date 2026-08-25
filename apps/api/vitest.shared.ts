import path from 'node:path';

/**
 * Alias compartidos por `vitest.config.ts` (unitarios) y `vitest.int.config.ts`
 * (integración contra Postgres). Viven acá para que agregar uno no obligue a
 * acordarse del segundo archivo.
 */
export const testAlias = {
  '@api': path.resolve(__dirname, 'src'),
  // Vite does not follow the `./queries/*` subpath pattern in @cio/db's
  // exports map, so any suite that transitively imported
  // `@cio/db/queries/...` failed to collect at all — ai-credits-usage.test.ts
  // has been red for that reason alone. Pointing at the built output lets
  // vite resolve the subpath as a plain directory (…/queries/agent/index.js).
  '@cio/db': path.resolve(__dirname, '../../packages/db/dist')
};

/** Los tests que necesitan una base de datos de verdad. */
export const INTEGRATION_TESTS = '**/*.int.test.ts';
