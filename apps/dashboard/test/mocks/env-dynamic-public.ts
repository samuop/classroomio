/**
 * `$env/dynamic/public` para Jest. Ver `app-environment.ts`.
 *
 * Vacío a propósito: un test que dependa de una variable de entorno concreta
 * tiene que decirlo él mismo, no heredarla de acá por accidente.
 */
export const env: Record<string, string | undefined> = {};
