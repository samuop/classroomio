import type { DashStatsSuccess, LoginActivityData, LoginActivitySuccess } from '$features/org/utils/types';
import { classroomio, getApiHeaders } from '$lib/utils/services/api';
import { type ServerApiResult, safeServerApi } from '$lib/utils/services/api/server';

/**
 * Las cifras del panel, guardadas un minuto por empresa.
 *
 * Antes era un objeto sin vencimiento que guardaba también el `null` de un
 * pedido fallido: una sola respuesta mala dejaba el panel en cero hasta el
 * próximo reinicio del proceso, y un curso nuevo no aparecía hasta el próximo
 * deploy. Ahora sólo se guarda lo que llegó bien, y por poco tiempo.
 */
const STATS_TTL_MS = 60_000;
const cache = new Map<string, { data: DashStatsSuccess['data']; at: number }>();

function cachedStats(orgId: string) {
  const entry = cache.get(orgId);
  if (!entry) return undefined;
  if (Date.now() - entry.at > STATS_TTL_MS) {
    cache.delete(orgId);
    return undefined;
  }
  return entry.data;
}

function loginActivityDataFromSettled(
  result: PromiseSettledResult<ServerApiResult<LoginActivitySuccess>>
): LoginActivityData {
  if (result.status === 'rejected') return [];
  if (!result.value.ok) return [];

  return result.value.body.data;
}

export const load = async ({ params, parent, cookies }) => {
  const { orgId } = await parent();
  const siteName = params.slug;

  if (!orgId) {
    return {
      orgName: siteName,
      stats: null,
      loginActivity: [] as LoginActivityData
    };
  }

  const cached = cachedStats(orgId);
  if (cached) {
    const loginActivityResult = await safeServerApi<LoginActivitySuccess>(() =>
      classroomio.dash['login-activity'].$get({ query: { orgId } }, getApiHeaders(cookies, orgId))
    );

    return {
      orgName: siteName,
      stats: cached,
      loginActivity: loginActivityResult.ok ? loginActivityResult.body.data : []
    };
  }

  // La API exige el id: `assertOrgAccess` rechaza con 400 el pedido que nombra
  // la empresa por su sitio (ver apps/api/src/utils/org-scope.ts).
  const [statsResult, loginActivityResult] = await Promise.allSettled([
    safeServerApi<DashStatsSuccess>(() =>
      classroomio.dash.stats.$get({ query: { orgId } }, getApiHeaders(cookies, orgId))
    ),
    safeServerApi<LoginActivitySuccess>(() =>
      classroomio.dash['login-activity'].$get({ query: { orgId } }, getApiHeaders(cookies, orgId))
    )
  ]);

  const stats = statsResult.status === 'fulfilled' && statsResult.value.ok ? statsResult.value.body.data : null;
  if (stats) cache.set(orgId, { data: stats, at: Date.now() });

  return {
    orgName: siteName,
    stats,
    loginActivity: loginActivityDataFromSettled(loginActivityResult)
  };
};
