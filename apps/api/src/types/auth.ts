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

export type AuthSession = {
  Variables: {
    actorId: string | null;
    auditError: AuditErrorDetail | null;
    automationKey: TOrganizationApiKey | null;
    orgId: string | null;
    orgRoles: Record<string, number>;
    session: SessionResult['session'] | null;
    user: SessionResult['user'] | null;
    userRole: number | null;
  };
};
