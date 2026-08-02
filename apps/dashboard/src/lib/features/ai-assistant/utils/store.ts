// Compatibility shim. The store module was renamed from `store.ts` to
// `store.svelte.ts` so the `$state` rune is processed by the Svelte Vite
// plugin. Vite's dep-optimizer still resolves the old `store` specifier
// from its cache; this shim makes the old path a no-op pass-through that
// re-exports the real module.
export * from './store.svelte';
