import * as Sentry from '@sentry/sveltekit';
import { dev } from '$app/environment';
import { env } from '$env/dynamic/public';
import { handleErrorWithSentry } from '@sentry/sveltekit';
import { installBrowserErrorReporting, reportIncident } from '$lib/utils/services/audit/report-incident';

const dsn = env.PUBLIC_SENTRY_DSN?.trim();
const isSelfHosted = env.PUBLIC_IS_SELFHOSTED === 'true';

if (dsn && !dev && !isSelfHosted) {
  Sentry.init({
    dsn,
    environment: env.PUBLIC_SENTRY_ENVIRONMENT?.trim() || 'production',
    tracesSampleRate: Number(env.PUBLIC_SENTRY_TRACES_SAMPLE_RATE ?? 0),
    replaysSessionSampleRate: Number(env.PUBLIC_SENTRY_REPLAYS_SESSION_SAMPLE_RATE ?? 0),
    replaysOnErrorSampleRate: Number(env.PUBLIC_SENTRY_REPLAYS_ON_ERROR_SAMPLE_RATE ?? 1),
    integrations: [Sentry.replayIntegration()]
  });
}

// Errores sueltos y promesas rechazadas sin `catch`. El `handleError` de abajo
// cubre los de navegación y renderizado; esto cubre el resto.
//
// Va acá y no en un componente a propósito: Sentry sólo se inicializa en la nube
// (`dsn && !dev && !isSelfHosted`), así que en esta instalación —autohospedada—
// la auditoría propia es lo ÚNICO que se entera de que una pantalla se rompió.
installBrowserErrorReporting();

/**
 * Errores que SvelteKit atrapa en el navegador: los que tira un `load` y los del
 * renderizado de una página.
 *
 * `handleErrorWithSentry` captura primero y después llama a este handler,
 * siempre — también en los 4xx, donde se saltea el captureException. Como acá
 * Sentry no está inicializado, este registro es el único que queda.
 *
 * El `console.error` es a mano porque pasar un handler propio REEMPLAZA al
 * default de Sentry, que era justamente el que logueaba a la consola. Sin esta
 * línea, un error de pantalla dejaría de verse mientras se desarrolla.
 */
export const handleError = handleErrorWithSentry(({ error, event, status, message }) => {
  console.error('[handleError]', status, event.url.pathname, error);

  reportIncident({
    kind: 'FRONTEND_ERROR',
    message: error instanceof Error ? error.message : (message ?? 'Error al dibujar la pantalla'),
    stack: error instanceof Error ? error.stack : undefined,
    status,
    route: event.url.pathname,
    metadata: {
      origin: 'sveltekit.handleError',
      // Qué ruta de SvelteKit estaba resolviendo. Dice el archivo del repo donde
      // buscar, que es lo primero que se necesita.
      routeId: event.route.id
    }
  });
});
