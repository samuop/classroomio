/**
 * `$env/static/public` para Jest. Ver `app-environment.ts`.
 *
 * Las estáticas se hornean en el build; en un test no hay build, así que cada
 * una queda indefinida y el código tiene que aguantar eso — que es justamente
 * lo que conviene comprobar.
 */
export {};
