import { auth } from '@cio/db/auth';
import type { TOrganizationApiKey } from '@db/types';

// Derive user/session from getSession's actual return type rather than
// auth.$Infer.Session. The plugin-augmented $Infer types are wider than what
// getSession's inferred return promises (e.g. banned, isAnonymous), so storing
// session.user against $Infer.Session.user fails to typecheck.
type SessionResult = NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>>;

export type AuthSession = {
  Variables: {
    actorId: string | null;
    automationKey: TOrganizationApiKey | null;
    orgId: string | null;
    orgRoles: Record<string, number>;
    session: SessionResult['session'] | null;
    user: SessionResult['user'] | null;
    userRole: number | null;
  };
};
