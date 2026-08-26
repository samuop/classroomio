import * as matchers from '@testing-library/jest-dom/matchers';

import { loadTranslations } from '$lib/utils/functions/translations';

/**
 * Los matchers de jest-dom (`toBeInTheDocument`, `toHaveValue`, `toBeDisabled`).
 *
 * Se extiende el `expect` **global** —el mismo objeto que llaman los tests— y
 * NO se importa `@testing-library/jest-dom/vitest`, que es el atajo obvio.
 *
 * Por qué: ese atajo hace `import { expect } from 'vitest'` adentro de jest-dom,
 * y jest-dom no tiene un `vitest` propio en su carpeta. Con pnpm eso resuelve al
 * que quedó **hoisteado** en `.pnpm/node_modules/`, y en este monorepo conviven
 * seis copias de vitest (1.6.1, 2.1.9 y 3.2.7). Si la hoisteada no es la del
 * dashboard, jest-dom le agrega los matchers a OTRA instancia y los tests fallan
 * con "Invalid Chai property: toHaveValue".
 *
 * Y no es teórico: acá pasaba porque la hoisteada resultó ser la 3.2.7; en un
 * runner limpio de CI fue otra, y 5 tests se cayeron (run 32965695807).
 * `./matchers` no importa vitest en absoluto, así que no hay ambigüedad posible.
 */
expect.extend(matchers);

/**
 * Lo que el navegador trae puesto y jsdom no.
 *
 * No es decoración: los componentes de `@cio/ui` (que salen de bits-ui) piden
 * estas tres al montarse. Sin ellas el test explota con `matchMedia is not a
 * function` y uno termina creyendo que el componente está roto.
 */
if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false
    }) as MediaQueryList;
}

class ObservadorNulo {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

globalThis.ResizeObserver ??= ObservadorNulo as unknown as typeof ResizeObserver;
globalThis.IntersectionObserver ??= ObservadorNulo as unknown as typeof IntersectionObserver;

// jsdom no implementa scroll: bits-ui lo llama al abrir menús y listas.
Element.prototype.scrollIntoView ??= () => {};

/**
 * Traducciones de verdad, en español.
 *
 * Cargar las mismas que usa la app es lo que permite que un test note que
 * **falta una clave**: sin esto `$t('emails.title')` devolvería siempre algo
 * plausible y la pantalla que muestra `notifications.settings.title` en crudo
 * —el bug que originó todo esto— pasaría en verde.
 */
await loadTranslations('es');
