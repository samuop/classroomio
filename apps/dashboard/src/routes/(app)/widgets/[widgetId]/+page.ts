import { WIDGETS_ENABLED } from '$lib/utils/constants/features';
import { currentOrgPath } from '$lib/utils/store/org';
import { get } from 'svelte/store';
import { redirect } from '@sveltejs/kit';

/**
 * El editor de widgets, apagado junto con el resto de la función.
 *
 * Hace falta este guardia aparte del de la lista: son dos rutas distintas
 * (`/widgets/<id>` no cuelga de `/org/<slug>`), y a ésta se llega por un enlace
 * guardado o por el historial del navegador aunque la lista ya no exista.
 *
 * Vuelve a la portada de la empresa. Si todavía no se sabe cuál es —recarga en
 * frío, antes de que el arranque llene el store— `currentOrgPath` vale `'#'`,
 * que no es una ruta: ahí se cae a la raíz, que resuelve sola.
 */
export const load = () => {
  if (!WIDGETS_ENABLED) {
    const empresa = get(currentOrgPath);

    throw redirect(302, empresa && empresa !== '#' ? empresa : '/');
  }

  return {};
};
