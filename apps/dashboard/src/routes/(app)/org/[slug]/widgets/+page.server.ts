import type { GetWidgetsSuccess } from '$features/widget/utils/types';
import { WIDGETS_ENABLED } from '$lib/utils/constants/features';
import { classroomio, getApiHeaders } from '$lib/utils/services/api';
import { safeServerApi } from '$lib/utils/services/api/server';
import { redirect } from '@sveltejs/kit';

export const load = async ({ parent, cookies, params }) => {
  // Apagado: la entrada del menú ya no está, pero un enlace guardado en favoritos
  // sí. Se corta acá arriba, antes de pedirle nada a la API.
  if (!WIDGETS_ENABLED) {
    throw redirect(302, `/org/${params.slug}`);
  }

  const { orgId } = await parent();

  if (!orgId) {
    return {
      initialWidgets: []
    };
  }

  const result = await safeServerApi<GetWidgetsSuccess>(() =>
    classroomio.organization.widgets.$get({}, getApiHeaders(cookies, orgId))
  );

  if (!result.ok && (result.status === 401 || result.status === 403)) {
    throw redirect(302, `/org/${params.slug}`);
  }

  return {
    initialWidgets: result.ok ? result.body.data : []
  };
};
