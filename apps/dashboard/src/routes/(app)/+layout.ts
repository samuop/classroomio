// The `(app)` group is the authenticated dashboard — it sits behind login and
// needs no SEO/SSR. Rendering it client-only avoids a Vite dev SSR crash from
// `layerchart`'s internal circular import (TransformContext <-> Chart), which
// the SSR module runner cannot resolve, and keeps the app lighter to serve.
export const ssr = false;

export const load = async ({ parent }) => {
  return await parent();
};
