import * as CONSTANTS from './constants';
import * as schema from '@db/schema';

import { admin, anonymous } from 'better-auth/plugins';
import { sendChangeEmailConfirmation, sendVerificationEmail } from './auth/email-verification';

import { betterAuth } from 'better-auth/minimal';
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
        after: async (session) => {
          await trackLoginHook(session);
        }
      },
      update: {
        after: async (session) => {
          await trackLoginHook(session);
        }
      }
    }
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
