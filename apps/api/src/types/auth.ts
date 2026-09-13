import { auth } from '@cio/db/auth';
import type { TOrganizationApiKey } from '@db/types';

// Derive user/session from getSession's actual return type rather than
// auth.$Infer.Session. The plugin-augmented $Infer types are wider than what
// getSession's inferred return promises (e.g. banned, isAnonymous), so storing
// session.user against $Infer.Session.user fails to typecheck.
type SessionResult = NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>>;

/**
 * Detalle del error que un route handler ya convirtió en respuesta JSON.
 *
 * Lo deja `handleError` y lo lee el middleware de auditoría. Sin esto, un fallo
 * atendido con `handleError` llega a la auditoría como un número de status
 * pelado: el mensaje real y el stack se quedaron en la consola del servidor,
 * que es justo donde no se pueden consultar tres días después.
 */
export type AuditErrorDetail = {
  message: string;
  code?: string;
  stack?: string;
};

/**
 * Lo que un handler declara para la auditoría, además de lo que el mapa ya sabe.
 *
 * El middleware ve el método, la ruta y el status, pero no el cuerpo, a
 * propósito: el cuerpo puede traer una clave. Hay acciones donde el QUÉ importa
 * tanto como el quién —cuánto crédito se cargó, de qué cupo a qué cupo se pasó—
 * y eso sólo lo sabe el handler. Lo deja con `anotarAuditoria`, campo por campo.
 */
export type AuditDetail = {
  /** Nombre de la acción, cuando el mapa no alcanza. */
  action?: string;
  entity?: string;
  entityId?: string;
  /** La empresa afectada, en las rutas que no la reciben por header (plataforma). */
  orgId?: string;
  /** Campos declarados uno por uno. NUNCA el cuerpo entero. */
  metadata?: Record<string, unknown>;
  /** Quién actuó cuando no hay sesión: una llamada entre servidores. */
  actor?: string;
};

export type AuthSession = {
  Variables: {
    actorId: string | null;
    auditDetail: AuditDetail | null;
    auditError: AuditErrorDetail | null;
    automationKey: TOrganizationApiKey | null;
    orgId: string | null;
    orgRoles: Record<string, number>;
    session: SessionResult['session'] | null;
    user: SessionResult['user'] | null;
    userRole: number | null;
  };
};
