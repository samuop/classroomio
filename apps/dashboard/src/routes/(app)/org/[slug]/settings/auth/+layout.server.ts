import { AUTH_SETTINGS_ENABLED } from '$lib/utils/constants/features';
import { redirect } from '@sveltejs/kit';

// Apagado: la solapa del menú ya no está, pero un enlace guardado en favoritos
// sí. Va en el layout y no en la página para que valga también para las rutas
// de abajo (`sso`, `token-auth`), que hoy sólo rebotan hacia acá.
export const load = async ({ params }) => {
  if (!AUTH_SETTINGS_ENABLED) {
    redirect(307, `/org/${params.slug}/settings`);
  }
};
