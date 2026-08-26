/**
 * `$app/paths` para los tests. Ver `app-environment.ts`.
 *
 * La app se sirve desde la raíz, así que `base` vacío es lo real y no una
 * simplificación. `resolve` devuelve la ruta tal cual: en producción sólo le
 * antepone `base`, que acá es ''.
 */
export const base = '';
export const assets = '';

export function resolve(pathname: string, params?: Record<string, string>): string {
  if (!params) return pathname;

  // Los parámetros se reemplazan igual que en SvelteKit: `/org/[slug]` + { slug }.
  return Object.entries(params).reduce((ruta, [clave, valor]) => ruta.replace(`[${clave}]`, valor), pathname);
}

export function resolveRoute(pathname: string, params?: Record<string, string>): string {
  return resolve(pathname, params);
}
