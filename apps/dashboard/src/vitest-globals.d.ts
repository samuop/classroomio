/// <reference types="vitest/globals" />

// `describe`, `it`, `expect` y `vi` sin importarlos en cada test.
//
// Antes esto lo daba `@types/jest`, que se fue con Jest. Va como referencia en
// un `.d.ts` y no como `"types"` en el tsconfig a propósito: poner `types`
// apaga la inclusión automática de TODO lo demás que hay en `@types`, y se
// rompen cosas lejos de acá.
