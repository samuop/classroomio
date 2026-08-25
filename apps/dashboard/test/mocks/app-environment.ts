/**
 * `$app/environment` para Jest.
 *
 * Jest no sabe nada de los alias virtuales de SvelteKit: cualquier módulo que
 * importe uno se vuelve intesteable, y como los alias están en la base de casi
 * todo (`base-url`, el reportador de incidencias, las utilidades de sesión),
 * eso dejaba fuera del alcance de los tests buena parte del dashboard.
 *
 * Los valores son los de un servidor en producción, que es el escenario en el
 * que uno quiere que la lógica se comporte bien.
 */
export const dev = false;
export const browser = false;
export const building = false;
export const version = 'test';
