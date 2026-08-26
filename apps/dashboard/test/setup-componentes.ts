import '@testing-library/jest-dom/vitest';

import { loadTranslations } from '$lib/utils/functions/translations';

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
