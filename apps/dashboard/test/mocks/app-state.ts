/**
 * `$app/state` para los tests. Ver `app-environment.ts`.
 *
 * Objeto plano y mutable, **sin runas**: este archivo también lo carga el
 * proyecto de lógica, que corre en Node sin el compilador de Svelte, y ahí un
 * `$state` no es nada. Un test que necesita estar "en" una URL concreta escribe
 * `page.params.slug = 'x'` antes de renderizar.
 *
 * Arranca en la portada de una empresa de mentira porque es la pantalla desde
 * la que se llega a casi todo el dashboard.
 */
export const page = {
  url: new URL('http://localhost/org/empresa-de-prueba'),
  params: {} as Record<string, string>,
  route: { id: null as string | null },
  status: 200,
  error: null as App.Error | null,
  data: {} as Record<string, unknown>,
  form: null as unknown,
  state: {} as App.PageState
};

export const navigating = {
  from: null as unknown,
  to: null as unknown,
  type: null as unknown,
  willUnload: false,
  delta: undefined as number | undefined,
  complete: null as unknown
};

export const updated = {
  current: false,
  check: async () => false
};
