/**
 * `$app/navigation` para los tests. Ver `app-environment.ts`.
 *
 * Navegar de verdad no existe acá: jsdom no tiene router. Cada función queda
 * como una promesa resuelta que no hace nada, y el test que quiera comprobar
 * que se navegó lo dice él mismo con `vi.spyOn` sobre esto.
 */
export const goto = async (_url: string | URL): Promise<void> => {};
export const invalidate = async (_resource: string | URL | ((url: URL) => boolean)): Promise<void> => {};
export const invalidateAll = async (): Promise<void> => {};
export const preloadData = async (_href: string): Promise<void> => {};
export const preloadCode = async (..._pathnames: string[]): Promise<void> => {};
export const pushState = (_url: string | URL, _state: App.PageState): void => {};
export const replaceState = (_url: string | URL, _state: App.PageState): void => {};
export const beforeNavigate = (_callback: unknown): void => {};
export const afterNavigate = (_callback: unknown): void => {};
export const onNavigate = (_callback: unknown): void => {};
export const disableScrollHandling = (): void => {};
