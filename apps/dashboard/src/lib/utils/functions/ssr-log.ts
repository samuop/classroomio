// Los `load` del servidor corren en CADA pantalla que se abre. Cuando cada uno
// escribía su tiempo siempre, el log del dashboard quedaba lleno de líneas
// idénticas —decenas por segundo cuando un robot barre el login— y los errores,
// que son lo único que se busca ahí, quedaban sepultados.
//
// La instrumentación no se tira: se calla cuando no hay nada que ver. Un `load`
// que tardó lo normal no dice nada que no sepamos; uno que se pasó del umbral,
// sí, y ese aparece solo en un log corto.
export const SLOW_SSR_LOAD_MS = 1000;

export function logSlowLoad(label: string, ms: number, detail?: string) {
  if (ms < SLOW_SSR_LOAD_MS) return;

  console.warn(`[${label}] load lento: ${ms}ms${detail ? ` (${detail})` : ''}`);
}
