import { getSessionData } from '$lib/utils/services/auth/session';
import { getHasCioCookies } from '$lib/utils/functions/cookies';
import { applyCspExtensions } from '$lib/utils/csp';
import { proxyRequestToApi, shouldForwardToApi } from '$lib/utils/proxy-api-request';
import { type Handle, type HandleServerError, redirect } from '@sveltejs/kit';
import { isPublicApiRoute, isPublicRoute } from '$lib/utils/functions/routes/isPublicRoute';
import { ROUTE } from '$lib/utils/constants/routes';
import { reportIncident } from '$lib/utils/services/audit/report-incident';

/**
 * Errores del servidor de SvelteKit: los que tira un `load` de servidor o el
 * renderizado en SSR.
 *
 * Se reenvían la cookie y el User-Agent originales porque la incidencia viaja
 * desde ESTE proceso a la API, no desde el navegador. Sin ellos la fila quedaría
 * a nombre de nadie y con "Servidor" como dispositivo, que es cierto pero
 * inútil: lo que interesa saber es a quién se le rompió la pantalla.
 */
export const handleError: HandleServerError = ({ error, event, status, message }) => {
  const err = error as Error;
  console.error('[handleError]', {
    status,
    message,
    method: event.request.method,
    url: event.url.toString(),
    name: err?.name,
    msg: err?.message,
    stack: err?.stack
  });

  const forwarded: Record<string, string> = {};
  for (const header of ['cookie', 'user-agent', 'cf-connecting-ip', 'x-forwarded-for']) {
    const value = event.request.headers.get(header);
    if (value) forwarded[header] = value;
  }

  reportIncident({
    kind: 'FRONTEND_ERROR',
    message: err?.message || message || 'Error al renderizar en el servidor',
    stack: err?.stack,
    status,
    route: event.url.pathname,
    method: event.request.method,
    headers: forwarded,
    metadata: { origin: 'sveltekit.handleError.server', routeId: event.route.id }
  });
};

const ANALYTICS_SESSION_COOKIE = 'cio_aid';
const ANALYTICS_SESSION_MAX_AGE = 60 * 60 * 24 * 90;

function ensureAnalyticsSessionCookie(cookies: Parameters<Handle>[0]['event']['cookies']) {
  if (cookies.get(ANALYTICS_SESSION_COOKIE)) return;

  cookies.set(ANALYTICS_SESSION_COOKIE, crypto.randomUUID(), {
    path: '/',
    httpOnly: false,
    sameSite: 'lax',
    secure: true,
    maxAge: ANALYTICS_SESSION_MAX_AGE
  });
}

export const handle: Handle = async (args) => {
  const { event } = args;

  if (shouldForwardToApi(event.url.pathname)) {
    return proxyRequestToApi(event.request);
  }

  const sessionData = await getSessionData(event.cookies);

  if (sessionData) {
    event.locals = sessionData;
  }

  if (!event.url.pathname.includes('/api')) {
    ensureAnalyticsSessionCookie(event.cookies);
  }

  let response: Response;

  if (event.url.pathname.includes('/api')) {
    response = await handleAPIRoutes(args);
  } else {
    response = await handlePagesRoutes(args);
  }

  return applyCspExtensions(response);
};

const handlePagesRoutes: Handle = async ({ event, resolve }) => {
  const { pathname } = event.url;
  const hasCioCookie = getHasCioCookies(event.cookies);

  if (isPublicRoute(pathname)) {
    return resolve(event);
  }

  if (!event?.locals?.user && !hasCioCookie) {
    console.log('no user and no cio cookie, redirecting to login');
    const shouldAddRedirectParam = !pathname.includes(ROUTE.LOGOUT);
    const fullPath = pathname + event.url.search;
    const redirectPath = shouldAddRedirectParam
      ? `${ROUTE.LOGIN}?redirect=${encodeURIComponent(fullPath)}`
      : ROUTE.LOGIN;

    return redirect(303, redirectPath);
  }

  return resolve(event);
};

const handleAPIRoutes: Handle = async ({ event, resolve }) => {
  const { pathname } = event.url;

  if (isPublicApiRoute(pathname)) {
    return resolve(event);
  }

  if (!event.locals.user) {
    redirect(303, '/login');
  }

  return resolve(event);
};
