import { configDefaults, defineConfig } from 'vitest/config';

import path from 'node:path';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { svelteTesting } from '@testing-library/svelte/vite';
import { fileURLToPath } from 'node:url';

/**
 * El corredor de tests del dashboard.
 *
 * Reemplaza a Jest, y no por gusto: `svelte-jester` corta con "Jest is being
 * called in CJS mode. You must use ESM mode in Svelte 4+", y toda la suite era
 * CommonJS a propósito. O sea que **montar un componente era imposible**, y por
 * eso un error de render llegó a producción con todo en verde. Vitest corre
 * sobre el mismo Vite que compila la app, así que el componente que se prueba
 * se compila igual que el que se despliega.
 *
 * De yapa, los módulos `.svelte.ts` (los que usan `$state`) también eran
 * intesteables con Jest: ts-jest dejaba `$state(...)` como una función que no
 * existe. Ahí vive todo el estado nuevo del dashboard.
 */

const aca = path.dirname(fileURLToPath(import.meta.url));
const r = (...p: string[]) => path.resolve(aca, ...p);

/**
 * Lo que Vite resuelve en la app, resuelto igual acá.
 *
 * Los alias de SvelteKit (`$lib`, `$features`) y los **virtuales** (`$app/*`,
 * `$env/*`) no son archivos: los inventa el plugin de SvelteKit durante el
 * build. Sin esto, cualquier módulo que importe uno queda fuera del alcance de
 * los tests — y están en la base de casi todo.
 *
 * Los paquetes del monorepo apuntan al **código fuente** y no a `dist/` a
 * propósito: así los tests no dependen de que alguien haya corrido el build
 * antes, que es la clase de requisito que nadie recuerda hasta que rompe.
 */
const alias = {
  $lib: r('src/lib'),
  $features: r('src/lib/features'),
  $mail: r('src/mail'),
  // Los componentes de @cio/ui se importan entre ellos por `$src/...`, un alias
  // que sólo existe en svelte.config.js. Sin espejarlo acá, montar cualquier
  // componente del paquete falla al resolver su propio botón.
  '$src/tools': r('node_modules/@cio/ui/src/tools/index.ts'),
  '$src/base': r('node_modules/@cio/ui/src/base'),
  '@cio/ui': r('node_modules/@cio/ui/src'),
  // TipTap es dependencia de @cio/ui, no del dashboard, así que un test que
  // monte la barra del editor tiene que buscarlo donde vive.
  '@tiptap/core': r('../../packages/ui/node_modules/@tiptap/core'),
  '@tiptap/pm': r('../../packages/ui/node_modules/@tiptap/pm'),
  '@tiptap/starter-kit': r('../../packages/ui/node_modules/@tiptap/starter-kit'),
  '@cio/utils': r('../../packages/utils/src'),
  '@cio/question-types': r('../../packages/question-types/src'),
  '@cio/db/types': r('node_modules/@cio/db/src/types.ts'),
  '$app/environment': r('test/mocks/app-environment.ts'),
  '$app/navigation': r('test/mocks/app-navigation.ts'),
  '$app/paths': r('test/mocks/app-paths.ts'),
  '$app/state': r('test/mocks/app-state.ts'),
  '$env/dynamic/public': r('test/mocks/env-dynamic-public.ts'),
  '$env/static/public': r('test/mocks/env-static-public.ts')
};

export default defineConfig({
  test: {
    /**
     * Dos proyectos, un solo `pnpm test`.
     *
     * Separados porque piden entornos distintos: la lógica pura corre en Node
     * —donde `browser` es `false`, que es el escenario del servidor— y los
     * componentes necesitan un DOM y que los paquetes se resuelvan por su
     * condición `browser`. Mezclarlos haría que la lógica se probara en un
     * entorno que no es el suyo.
     */
    projects: [
      {
        root: aca,
        resolve: { alias },
        test: {
          name: 'logica',
          environment: 'node',
          // `describe`/`it`/`expect` sin importar, como con Jest: los tests que
          // ya existían los usan así y no hay motivo para tocarlos.
          globals: true,
          include: ['src/**/*.test.ts'],
          exclude: [...configDefaults.exclude, 'src/**/*.svelte.test.ts']
        }
      },
      {
        root: aca,
        plugins: [svelte(), svelteTesting()],
        resolve: { alias, conditions: ['browser'] },
        test: {
          name: 'componentes',
          environment: 'jsdom',
          globals: true,
          include: ['src/**/*.svelte.test.ts'],
          setupFiles: [r('test/setup-componentes.ts')],
          /**
           * Las bibliotecas de componentes se compilan acá adentro.
           *
           * Vitest deja los paquetes de `node_modules` afuera del pipeline de
           * Vite por velocidad, pero un `.svelte` sin compilar no lo puede
           * importar nadie: Node no sabe qué es. Estas tres publican
           * componentes en fuente.
           */
          server: {
            deps: {
              // Una lista nombrada acá era una trampa: el barrel de `@cio/ui`
              // arrastra media docena de bibliotecas de componentes, así que
              // cada componente nuevo que se quiera testear descubría otra
              // —layerchart, vaul-svelte— y fallaba con "Unknown file
              // extension .svelte" ANTES de correr un solo test. Inlinear todo
              // cuesta unos segundos de arranque y elimina la clase entera de
              // fallas.
              inline: true
            }
          }
        }
      }
    ]
  }
});
