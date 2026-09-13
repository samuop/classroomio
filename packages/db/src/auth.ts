import * as CONSTANTS from './constants';
import * as schema from '@db/schema';

import { admin, anonymous } from 'better-auth/plugins';
import { sendChangeEmailConfirmation, sendVerificationEmail } from './auth/email-verification';

import { avisarIngreso, errorDeLoDevuelto } from './auth/audit-bridge';
import { betterAuth } from 'better-auth/minimal';
import { createAuthMiddleware } from 'better-auth/api';
import { createProfileHook } from './auth/hooks/create-profile';
import { customSession } from 'better-auth/plugins/custom-session';
import { db } from '@db/drizzle';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { config as emailAndPassword } from './auth/email-password';
import { getUserOrgRolesMap } from './queries/organization/organization';
import { loginLink } from './auth/plugins/login-link';
import { oAuthProxy } from 'better-auth/plugins/oauth-proxy';
import { buildTrustedOrigins } from './utils';
import { sso } from '@better-auth/sso';
import { syncUserWithProfile } from './auth/hooks/sync-user';
import { tokenExchange } from './auth/plugins/token-exchange';
import { trackLoginHook } from './auth/hooks/track-login';

/**
 * Cloud (multi-tenant) only. Routes OAuth/SSO callbacks to the canonical
 * production URL while completing the flow on whichever tenant host the
 * user signed in from (<org>.myclassroomio.com or a BYOD domain).
 *
 * Self-hosted instances run with one apex (api.<domain> + app.<domain>)
 * and use AUTH_COOKIE_DOMAIN for cross-subdomain cookies, so the proxy
 * isn't needed there.
 */
function buildOAuthProxyPlugin() {
  if (process.env.PUBLIC_IS_SELFHOSTED === 'true') {
    return [];
  }
  return [oAuthProxy({ productionURL: CONSTANTS.BASE_URL })];
}

export const auth = betterAuth({
  baseURL: CONSTANTS.BASE_URL,
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema
    // debugLogs: true
  }),
  emailAndPassword: emailAndPassword,
  user: {
    changeEmail: {
      enabled: true,
      sendChangeEmailConfirmation
    }
  },
  emailVerification: {
    enabled: true,
    sendVerificationEmail
  },
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      accessType: 'offline',
      prompt: 'select_account consent'
    }
  },
  trustedOrigins: (request) => buildTrustedOrigins(request?.headers.get('origin')),
  advanced: {
    cookiePrefix: 'classroomio',
    // Cloud (multi-tenant): host-only cookies on each tenant/BYOD domain.
    // Self-hosted: cross-subdomain cookies under AUTH_COOKIE_DOMAIN so the
    // session set on `api.<apex>` is also sent to `app.<apex>`.
    crossSubDomainCookies: process.env.AUTH_COOKIE_DOMAIN?.trim()
      ? { enabled: true, domain: process.env.AUTH_COOKIE_DOMAIN.trim() }
      : { enabled: false },
    database: {
      generateId: false
    }
  },
  account: {
    storeAccountCookie: true
  },
  session: {
    expiresIn: 60 * 60 * 24 * 30, // 30 days
    updateAge: 60 * 60 * 24, // 1 day (every 1 day the session expiration is updated)
    cookieCache: {
      enabled: true,
      maxAge: 60 * 60 // 1 hour
    }
  },
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          console.log('[auth] databaseHooks.user.create.after: running', { userId: user.id });
          await createProfileHook(user);
        }
      },
      update: {
        after: async (user) => {
          console.log('[auth] databaseHooks.user.update.after: running', { userId: user.id });
          await syncUserWithProfile(user);
        }
      }
    },
    session: {
      create: {
        after: async (session, context) => {
          avisarIngreso({
            tipo: 'sesion-creada',
            ruta: context?.path ?? null,
            metodo: context?.request?.method ?? null,
            headers: context?.headers ?? context?.request?.headers ?? null,
            sesion: {
              id: session.id,
              userId: session.userId,
              impersonatedBy: typeof session.impersonatedBy === 'string' ? session.impersonatedBy : null
            }
          });
          await trackLoginHook(session);
        }
      },
      update: {
        after: async (session) => {
          await trackLoginHook(session);
        }
      },
      delete: {
        after: async (session, context) => {
          avisarIngreso({
            tipo: 'sesion-borrada',
            ruta: context?.path ?? null,
            metodo: context?.request?.method ?? null,
            headers: context?.headers ?? context?.request?.headers ?? null,
            sesion: { id: session.id, userId: session.userId }
          });
        }
      }
    }
  },
  hooks: {
    /**
     * Cada endpoint de ingreso, cuenta y administración le avisa a la auditoría
     * cómo terminó: sin esto, un intento fallido o un cambio de contraseña no
     * dejaban rastro. Qué se guarda lo decide la API (ver `audit-bridge.ts`).
     * El sondeo de sesión se corta acá: pasa en cada navegación.
     */
    after: createAuthMiddleware(async (ctx) => {
      if (ctx.path === '/get-session' || ctx.path === '/ok' || ctx.path === '/error') return;

      // Un hook `after` que tira convierte la respuesta en un 500: la auditoría
      // no puede costar un login.
      try {
        const sesion = ctx.context.session ?? ctx.context.newSession ?? null;

        avisarIngreso({
          tipo: 'endpoint',
          ruta: ctx.path,
          metodo: ctx.request?.method ?? null,
          headers: ctx.headers ?? ctx.request?.headers ?? null,
          cuerpo: ctx.body,
          error: errorDeLoDevuelto(ctx.context.returned),
          usuario: sesion?.user ? { id: sesion.user.id, email: sesion.user.email ?? null } : null,
          sesionId: sesion?.session?.id ?? null
        });
      } catch (error) {
        console.error('[auth-audit] no se pudo armar el aviso', ctx.path, error);
      }
    })
  },
  plugins: [
    // `platformAdmin` (PLATFORM_ROLE.ADMIN) is our SaaS-operator role, stored on
    // Better Auth's global `user.role`. The /platform panel authorizes it via
    // platformAdminMiddleware, which reads `user.role` directly — it does NOT go
    // through this plugin. We intentionally do NOT add it to `adminRoles`: this
    // plugin (v1.6) requires any adminRole to also be declared in an access-
    // control `roles` map, and platform admins don't need the admin plugin's
    // own endpoints (list/ban/impersonate) yet. Add it here with a matching
    // `roles` entry if that capability is needed later.
    admin(),
    anonymous(),
    sso({
      // OIDC providers are registered dynamically per organization
      // via the admin API (auth.api.registerSSOProvider)
    }),
    ...buildOAuthProxyPlugin(),
    loginLink(),
    tokenExchange(),
    // Attaches the user's org memberships ({ [orgId]: roleId }) to the session
    // so org-scoped middlewares can authorize without a per-request DB query.
    // Refreshes when the session cookie cache expires (see session.cookieCache.maxAge).
    customSession(async ({ user, session }) => {
      let orgRoles: Record<string, number> = {};
      try {
        if (user?.id) {
          orgRoles = await getUserOrgRolesMap(user.id);
        }
      } catch (error) {
        console.error('customSession: failed to load orgRoles', error);
      }
      return { user, session, orgRoles };
    })
  ]
});
