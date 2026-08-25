/**
 * CommonJS on purpose. Jest parses its config with ts-node in CJS mode, and the
 * previous `jest.config.ts` mixed an ESM `export default` with a CommonJS
 * `module.exports`: under `verbatimModuleSyntax` that is a parse error, so
 * `pnpm test` failed before running a single test and the dashboard suite was
 * effectively dead. A `.cjs` config sidesteps the module-format argument.
 *
 * @type {import('ts-jest').JestConfigWithTsJest}
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  transform: {
    '^.+\\.svelte$': 'svelte-jester',
    '^.+\\.ts$': 'ts-jest',
    '\\.[jt]sx?$': 'babel-jest'
  },
  moduleNameMapper: {
    // Los alias VIRTUALES de SvelteKit: no son archivos, los genera Vite en el
    // build. Sin estos mapeos, cualquier modulo que importe uno es intesteable
    // -- y estan en la base de casi todo (base-url, el reportador de
    // incidencias, las utilidades de sesion), asi que dejaban fuera del alcance
    // de los tests buena parte del dashboard.
    '^\\$app/environment$': '<rootDir>/test/mocks/app-environment.ts',
    '^\\$env/dynamic/public$': '<rootDir>/test/mocks/env-dynamic-public.ts',
    '^\\$env/static/public$': '<rootDir>/test/mocks/env-static-public.ts',
    // SvelteKit's own aliases, which Jest knows nothing about.
    '^\\$lib/(.*)$': '<rootDir>/src/lib/$1',
    '^\\$features/(.*)$': '<rootDir>/src/lib/features/$1',
    // Mirrors the `@cio/ui` alias in svelte.config.js: the package ships source,
    // not a build, so Jest has to resolve it the way Vite does.
    '^@cio/ui/(.*)$': '<rootDir>/node_modules/@cio/ui/src/$1',
    '^@cio/ui$': '<rootDir>/node_modules/@cio/ui/src',
    // `@cio/utils` publishes an ESM build that Jest cannot parse in CJS mode.
    // Point at the TypeScript source so ts-jest compiles it like any other file.
    '^@cio/utils/(.*)$': '<rootDir>/../../packages/utils/src/$1',
    '^@cio/utils$': '<rootDir>/../../packages/utils/src',
    // Same reason, reached transitively through `@cio/utils`.
    '^@cio/question-types$': '<rootDir>/../../packages/question-types/src'
  }
};
