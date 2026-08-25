/**
 * Registro de acciones e incidencias.
 *
 * REGLA QUE MANDA SOBRE TODO LO DEMÁS: **la auditoría nunca rompe el flujo**.
 * Cada función traga sus propios errores. Si la tabla se llena, si Postgres está
 * caído o si un campo no entra, el usuario no se entera: perder un renglón del
 * registro es infinitamente preferible a perder la acción que se estaba
 * auditando.
 */

import { hasRecentAuditEvent, insertAuditEvent, insertAuditIncident, purgeAuditBefore } from '@cio/db/queries/audit';

import { env } from '@api/config/env';

/** Días que se conserva el registro antes de purgarse. */
export const AUDIT_RETENTION_DAYS = env.AUDIT_RETENTION_DAYS;

/** Ventana de la regla anti-repetición para las lecturas. */
const REPEAT_WINDOW_MS = 5 * 60 * 1000;

/**
 * Un uuid válido, o null.
 *
 * Las tres columnas de identidad (`org_id`, `user_id`, `session_id`) son `uuid`
 * y Postgres rechaza la fila entera si le llega cualquier otro texto. El
 * `cio-org-id` lo manda el cliente y el reporte del navegador llega sin
 * validar, así que el saneo va acá —en el único camino por el que se escribe—
 * y no repetido en cada quien llama.
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function toUuid(value: string | null | undefined): string | null {
  const trimmed = value?.trim();

  return trimmed && UUID_PATTERN.test(trimmed) ? trimmed : null;
}

/** Topes de tamaño. Casi todo esto puede venir del cliente. */
const MAX_MESSAGE = 2000;
const MAX_STACK = 8000;
const MAX_ROUTE = 1000;
const MAX_CODE = 100;

export type IncidentKind = 'BACKEND_ERROR' | 'FRONTEND_ERROR' | 'REQUEST_FAILED' | 'SLOW_REQUEST';
export type IncidentSource = 'BACKEND' | 'FRONTEND';

export interface RecordEventParams {
  orgId: string | null;
  userId: string | null;
  userLabel: string | null;
  userRole: string | null;
  orgRole: number | null;
  sessionId: string | null;
  action: string;
  entity?: string | null;
  entityId?: string | null;
  metadata?: Record<string, unknown> | null;
  ip: string | null;
  device: string | null;
  browser: string | null;
  userAgent: string | null;
  method: string;
  route: string;
  status: number;
  durationMs: number;
  /**
   * Si es true, se saltea la ventana anti-repetición. Lo usan las escrituras:
   * cada una cambió algo distinto y perder la segunda sería perder un hecho.
   */
  always?: boolean;
}

export async function recordEvent(params: RecordEventParams): Promise<void> {
  try {
    if (!params.always) {
      const repeated = await hasRecentAuditEvent({
        orgId: toUuid(params.orgId),
        userId: toUuid(params.userId),
        action: params.action,
        entityId: params.entityId ?? null,
        since: new Date(Date.now() - REPEAT_WINDOW_MS).toISOString()
      });
      if (repeated) return;
    }

    await insertAuditEvent({
      orgId: toUuid(params.orgId),
      userId: toUuid(params.userId),
      userLabel: params.userLabel,
      userRole: params.userRole,
      orgRole: params.orgRole,
      sessionId: toUuid(params.sessionId),
      action: params.action.slice(0, MAX_ROUTE),
      entity: params.entity ?? null,
      entityId: params.entityId ?? null,
      metadata: params.metadata ?? null,
      ip: params.ip,
      device: params.device,
      browser: params.browser,
      userAgent: params.userAgent,
      method: params.method,
      route: params.route.slice(0, MAX_ROUTE),
      status: params.status,
      durationMs: params.durationMs
    });
  } catch (error) {
    console.error('[audit] no se pudo registrar el evento', params.action, error);
  }
}

export interface RecordIncidentParams {
  kind: IncidentKind;
  source: IncidentSource;
  message: string;
  stack?: string | null;
  code?: string | null;
  status?: number | null;
  route?: string | null;
  method?: string | null;
  durationMs?: number | null;
  orgId?: string | null;
  userId?: string | null;
  userLabel?: string | null;
  sessionId?: string | null;
  ip?: string | null;
  device?: string | null;
  browser?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown> | null;
}

export async function recordIncident(params: RecordIncidentParams): Promise<void> {
  try {
    await insertAuditIncident({
      kind: params.kind,
      source: params.source,
      message: params.message.slice(0, MAX_MESSAGE),
      stack: params.stack?.slice(0, MAX_STACK) ?? null,
      code: params.code?.slice(0, MAX_CODE) ?? null,
      status: params.status ?? null,
      route: params.route?.slice(0, MAX_ROUTE) ?? null,
      method: params.method ?? null,
      durationMs: params.durationMs ?? null,
      orgId: toUuid(params.orgId),
      userId: toUuid(params.userId),
      userLabel: params.userLabel ?? null,
      sessionId: toUuid(params.sessionId),
      ip: params.ip ?? null,
      device: params.device ?? null,
      browser: params.browser ?? null,
      userAgent: params.userAgent ?? null,
      metadata: params.metadata ?? null
    });
  } catch (error) {
    console.error('[audit] no se pudo registrar la incidencia', params.kind, error);
  }
}

/** Borra lo anterior a la retención configurada. Devuelve null si falló. */
export async function purgeAudit(): Promise<{ events: number; incidents: number } | null> {
  try {
    const cutoff = new Date(Date.now() - AUDIT_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();

    return await purgeAuditBefore(cutoff);
  } catch (error) {
    console.error('[audit] falló la purga', error);

    return null;
  }
}
