/**
 * Registra en la auditoría lo que pasa por la API. Se monta UNA sola vez, en
 * `app.ts`, sobre `*`.
 *
 * Por qué un solo middleware y no una llamada en cada route handler: la idea es
 * que el propio request ya dice qué estaba haciendo la persona — si llega un GET
 * al seguimiento de una empresa, está mirando ese seguimiento. Instrumentar
 * cincuenta handlers a mano significa que el día que se agrega el cincuenta y
 * uno, alguien se olvida.
 *
 * El detalle que lo hace funcionar: **no registra al entrar sino después de
 * `await next()`**. Para ese momento ya corrieron los middlewares de la ruta
 * (`authMiddleware`, `orgMemberMiddleware`…), así que un único montaje global
 * sabe quién fue, sobre qué empresa, con qué status salió y cuánto tardó, sin
 * tocar ninguna ruta.
 */

import type { Context, Next } from 'hono';

import {
  SLOW_REQUEST_MS,
  findInAuditMap,
  genericAction,
  isExcluded,
  isWrite,
  redactRoute
} from '@api/utils/audit-map';
import type { AuditDetail } from '@api/types/auth';
import { clientInfoFromHeaders } from '@api/utils/client-info';
import { recordEvent, recordIncident } from '@api/services/audit';

/**
 * El rol que la persona tiene EN la empresa del request.
 *
 * Antes esto salía de `c.get('userRole')`, que **sólo escribe
 * `orgMemberMiddleware`**. Las rutas de administración (`/team`, `/audience`,
 * `/tracking/overview`) usan `orgTeamMemberMiddleware`, que calcula el mismo rol
 * y nunca lo pone en el contexto: el resultado era `org_role` NULO en el 100% de
 * las filas, justo en las rutas donde saber si quien miró era admin o tutor es
 * todo el punto de auditar.
 *
 * Resolverlo desde `orgRoles` — que `app.ts` deja siempre en el contexto para
 * cualquier sesión — saca del medio la dependencia de que cada middleware se
 * acuerde de avisar. Un middleware nuevo no puede volver a romperlo por omisión.
 */
export function resolveOrgRole(
  orgRoles: Record<string, number> | undefined,
  orgId: string | null
): number | null {
  if (!orgId) return null;

  return orgRoles?.[orgId] ?? null;
}

export const auditRequest = async (c: Context, next: Next) => {
  const startedAt = performance.now();

  await next();

  const durationMs = Math.round(performance.now() - startedAt);

  // Todo el registro va envuelto y SIN await: la respuesta del usuario ya está
  // armada y nada de esto puede demorarla ni tumbarla.
  void persistAudit(c, durationMs).catch(() => {
    // El service ya loguea. Un throw acá sería un unhandledRejection fuera del
    // ciclo del request, que es peor que perder el renglón.
  });
};

async function persistAudit(c: Context, durationMs: number): Promise<void> {
  const url = new URL(c.req.url);
  const path = url.pathname;

  if (isExcluded(path)) return;

  const status = c.res.status;
  const method = c.req.method;
  // La ruta que se guarda, con los tokens tapados: una invitación lleva su
  // secreto en la URL, y la tabla de auditoría no puede ser donde quede escrito.
  const route = redactRoute(path);

  const failed = status >= 400;
  const slow = durationMs >= SLOW_REQUEST_MS;
  const writes = isWrite(method);
  const mapped = findInAuditMap(method, url);
  // Lo que el handler declaró con `anotarAuditoria`: el QUÉ que el middleware no
  // puede ver sin leer el cuerpo.
  const detail = (c.get('auditDetail') as AuditDetail | null | undefined) ?? null;

  // La regla: falló, tardó de más, escribió, es una lectura declarada, o el
  // handler pidió que quedara registrado.
  if (!failed && !slow && !writes && !mapped && !detail) return;

  const user = c.get('user');
  const session = c.get('session');
  const client = clientInfoFromHeaders(c.req.raw.headers);

  // El orgId puede venir de tres lados y ninguno está garantizado: lo pone
  // `orgMemberMiddleware` cuando la ruta lo exige, y si no, el header que manda
  // el dashboard. En las rutas de plataforma no hay empresa activa: son
  // cross-empresa a propósito.
  const orgId = detail?.orgId ?? c.get('orgId') ?? c.req.header('cio-org-id') ?? null;
  const userId = user?.id ?? null;
  const sessionId = session?.id ?? null;

  // ── Incidencias: lo que falló o tardó de más ──
  // Van aparte de los eventos porque son de otra naturaleza: no describen lo que
  // alguien quiso hacer sino que algo anduvo mal.
  if (failed || slow) {
    // `c.error` trae el error que se escapó hasta `app.onError`; `auditError` el
    // que un handler ya atendió con `handleError`. Entre los dos cubren los dos
    // caminos por los que la API responde con un fallo.
    const thrown = c.error;
    const handled = c.get('auditError');
    const isServerError = status >= 500;

    await recordIncident({
      kind: !failed ? 'SLOW_REQUEST' : isServerError ? 'BACKEND_ERROR' : 'REQUEST_FAILED',
      source: 'BACKEND',
      message: !failed
        ? `${method} ${route} tardó ${durationMs}ms`
        : (thrown?.message ?? handled?.message ?? `${method} ${route} respondió ${status}`),
      code: handled?.code ?? null,
      // El stack sólo para 5xx: en un 403 esperable no aporta nada y ocupa.
      stack: isServerError ? (thrown?.stack ?? handled?.stack ?? null) : null,
      status,
      route,
      method,
      durationMs,
      orgId,
      userId,
      userLabel: user?.email ?? detail?.actor ?? null,
      sessionId,
      // Un intento rechazado de cargar crédito vale por lo que se intentó.
      metadata: detail?.metadata ?? null,
      ip: client.ip,
      device: client.device,
      browser: client.browser,
      userAgent: client.userAgent
    });
  }

  // ── Eventos: qué hizo la persona ──
  // Sin usuario no hay nada que atribuir (un 401 ya quedó como incidencia),
  // salvo una llamada entre servidores que el handler firmó con `actor`.
  if (!user && !detail?.actor) return;
  if (!writes && !mapped && !detail) return;
  // Una escritura que falló no cambió nada: ya quedó como incidencia, y
  // registrarla como acción diría que ocurrió algo que no ocurrió.
  if (failed) return;

  const metadata = mapped?.metadata || detail?.metadata ? { ...mapped?.metadata, ...detail?.metadata } : null;

  await recordEvent({
    orgId,
    userId,
    userLabel: user?.email ?? detail?.actor ?? null,
    userRole: user?.role ?? null,
    orgRole: resolveOrgRole(c.get('orgRoles'), orgId),
    sessionId,
    action: detail?.action ?? mapped?.action ?? genericAction(method, route),
    entity: detail?.entity ?? mapped?.entity ?? null,
    entityId: detail?.entityId ?? mapped?.entityId ?? null,
    metadata,
    ip: client.ip,
    device: client.device,
    browser: client.browser,
    userAgent: client.userAgent,
    method,
    route,
    status,
    durationMs,
    // Las escrituras siempre se registran: cada una cambió algo distinto. La
    // ventana anti-repetición es para las lecturas, que se repiten solas cuando
    // el dashboard vuelve a pedir los datos al recuperar el foco.
    always: writes
  });
}
