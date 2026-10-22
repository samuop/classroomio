import type { Context, MiddlewareHandler, Next } from 'hono';
import {
  checkEmailExistsInOrg,
  getFirstOrganization,
  getOrganizationById,
  hasActiveOrganizationInviteForEmailAnywhere,
  hasActiveOrganizationInviteForEmailInAccount
} from '@cio/db/queries/organization';

import { env } from '@api/config/env';

type OrgSettings = {
  signup?: {
    inviteOnly?: boolean;
  };
};

type SignupRequestBody = {
  email?: string;
};

const SELF_HOSTED_ORG_CONTEXT_REQUIRED = {
  code: 'ORG_CONTEXT_REQUIRED',
  message: 'Organization context is required for signup on self-hosted instances'
} as const;

const INVALID_REQUEST = {
  code: 'INVALID_REQUEST',
  message: 'Could not parse request body'
} as const;

const EMAIL_REQUIRED = {
  code: 'INVALID_REQUEST',
  message: 'Email is required'
} as const;

const SIGNUP_DISABLED = {
  code: 'SIGNUP_DISABLED',
  message: 'Signup is disabled for this organization'
} as const;

const INVITE_REQUIRED = {
  code: 'INVITE_REQUIRED',
  message: 'This organization requires an invitation to sign up'
} as const;

const isSelfHosted = env.PUBLIC_IS_SELFHOSTED === 'true';

function normalizeEmail(email?: string) {
  return email?.trim().toLowerCase();
}

async function getSignupEmail(c: Context) {
  try {
    const body = (await c.req.raw.clone().json()) as SignupRequestBody;
    return {
      email: normalizeEmail(body?.email),
      parseFailed: false
    };
  } catch {
    return {
      email: undefined,
      parseFailed: true
    };
  }
}

async function getOrganizationSafely(orgId: string) {
  try {
    return await getOrganizationById(orgId);
  } catch {
    return null;
  }
}

/**
 * Un registro desde el dominio raíz (sin empresa en el encabezado) sólo pasa con
 * una invitación vigente a alguna empresa.
 *
 * Ahí el registro era libre: cualquiera creaba una cuenta y el onboarding le
 * ofrecía armar su propia empresa. En este despliegue las cuentas se crean sólo
 * por invitación — también la del administrador de una empresa nueva, que se
 * invita desde la empresa que se crea para él.
 */
async function handleRootSignup(c: Context, next: Next) {
  const { email, parseFailed } = await getSignupEmail(c);

  if (parseFailed) {
    return c.json(INVALID_REQUEST, 400);
  }

  if (!email) {
    return c.json(EMAIL_REQUIRED, 400);
  }

  if (!(await hasActiveOrganizationInviteForEmailAnywhere(email))) {
    return c.json(INVITE_REQUIRED, 403);
  }

  await next();
}

async function canProceedWithoutOrgContext(c: Context) {
  const firstOrg = await getFirstOrganization();
  if (!firstOrg) {
    return true;
  }

  const { email, parseFailed } = await getSignupEmail(c);
  if (parseFailed || !email) {
    return false;
  }

  return checkEmailExistsInOrg(firstOrg.id, email);
}

function isInviteOnlySignup(settings: OrgSettings | null) {
  return settings?.signup?.inviteOnly ?? false;
}

async function handleInviteOnlySignup(c: Context, next: Next, accountRootId: string) {
  const { email, parseFailed } = await getSignupEmail(c);

  if (parseFailed) {
    return c.json(INVALID_REQUEST, 400);
  }

  if (!email) {
    return c.json(EMAIL_REQUIRED, 400);
  }

  // La invitación vale si es de CUALQUIER empresa de la cuenta, no sólo de la del
  // encabezado: ver `hasActiveOrganizationInviteForEmailInAccount`.
  const hasInvite = await hasActiveOrganizationInviteForEmailInAccount(accountRootId, email);
  if (!hasInvite) {
    return c.json(INVITE_REQUIRED, 403);
  }

  await next();
}

/**
 * Enforces organization-level signup restrictions server-side.
 *
 * When the `cio-org-id` header is present the middleware looks up the org and
 * rejects the request when:
 *   - `disableSignup` is true, or
 *   - `settings.signup.inviteOnly` is true and the email has no active invite in
 *     any organization of the same account (the org's root and its children).
 *
 * When the `cio-org-id` header is absent:
 *   - Non-self-hosted (the root domain): require an active invite to some org.
 *   - Self-hosted: require the header unless no orgs exist yet (bootstrap), or the
 *     signup email is already an organization member (e.g. invited, profile_id null).
 */
export const signupGuard: MiddlewareHandler = async (c, next) => {
  const orgId = c.req.header('cio-org-id');

  if (!orgId) {
    if (!isSelfHosted) {
      return handleRootSignup(c, next);
    }

    const canContinue = await canProceedWithoutOrgContext(c);
    if (!canContinue) {
      return c.json(SELF_HOSTED_ORG_CONTEXT_REQUIRED, 400);
    }

    await next();
    return;
  }

  const org = await getOrganizationSafely(orgId);
  if (!org) {
    await next();
    return;
  }

  if (org.disableSignup) {
    return c.json(SIGNUP_DISABLED, 403);
  }

  const settings = org.settings as OrgSettings | null;
  if (!isInviteOnlySignup(settings)) {
    await next();
    return;
  }

  return handleInviteOnlySignup(c, next, org.parentOrganizationId ?? org.id);
};
