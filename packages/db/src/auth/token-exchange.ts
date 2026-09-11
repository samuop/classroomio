import * as schema from '@db/schema';

import { and, eq, isNull, or } from 'drizzle-orm';
import { jwtVerify } from 'jose';

import { getAllActiveTokenAuth } from '@db/queries/organization/token-auth';
import { ensureOrgMembership } from './hooks/sso-provisioning';
import { db } from '@db/drizzle';
import { ZTokenExchangePayload } from '@cio/utils/validation/organization';
import type { User } from 'better-auth';

const MAX_TOKEN_AGE_SEC = 5 * 60; // 5 minutes

export class TokenExchangeError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number
  ) {
    super(message);
    this.name = 'TokenExchangeError';
  }
}

/**
 * El token de una empresa sólo puede reclamar identidades de ESA empresa.
 *
 * Antes alcanzaba con que el correo existiera en cualquier parte: se buscaba el
 * usuario por correo en toda la base y, si aparecía, se le abría sesión. Eso
 * convertía el secreto de firma de cualquier empresa cliente en una llave
 * maestra — firmar un token con el correo del operador de la plataforma, o con
 * el de un alumno de otro cliente, devolvía la sesión de esa persona. El secreto
 * lo genera y lo ve el admin de cada empresa desde su propia pantalla.
 *
 * Dos cierres, en orden de gravedad:
 *
 * 1. Una cuenta con rol global (hoy, el operador de la plataforma) NUNCA entra
 *    por acá, tenga o no fila de membresía — esa fila la puede fabricar el admin
 *    de la empresa importando el correo a su audiencia. Se rechaza cualquier rol
 *    que no sea el común, y no sólo los conocidos: un rol nuevo tiene que entrar
 *    a esta lista a propósito, no heredar el permiso por olvido.
 * 2. El resto de las cuentas que ya existen tienen que estar YA relacionadas con
 *    la empresa que firma: miembro, fila creada por la importación de audiencia
 *    (mismo correo, todavía sin perfil) o invitación abierta. Para alguien nuevo
 *    no cambia nada: se crea como siempre.
 */
async function assertTokenMayClaim(
  userId: string,
  role: string | null,
  emailLower: string,
  orgId: string
): Promise<void> {
  if (role && role !== 'user') {
    console.warn('token-exchange: cuenta con rol global rechazada', { orgId, role });
    throw new TokenExchangeError(
      'This account cannot be signed in with an organization token',
      'TOKEN_EXCHANGE_PRIVILEGED_ACCOUNT',
      403
    );
  }

  const [member] = await db
    .select({ id: schema.organizationmember.id })
    .from(schema.organizationmember)
    .where(
      and(
        eq(schema.organizationmember.organizationId, orgId),
        or(
          eq(schema.organizationmember.profileId, userId),
          eq(schema.organizationmember.email, emailLower)
        )
      )
    )
    .limit(1);

  if (member) return;

  const [invite] = await db
    .select({ id: schema.organizationInvite.id })
    .from(schema.organizationInvite)
    .where(
      and(
        eq(schema.organizationInvite.organizationId, orgId),
        eq(schema.organizationInvite.email, emailLower),
        eq(schema.organizationInvite.isRevoked, false),
        isNull(schema.organizationInvite.acceptedAt)
      )
    )
    .limit(1);

  if (invite) return;

  console.warn('token-exchange: cuenta ajena a la empresa rechazada', { orgId });
  throw new TokenExchangeError(
    'That account exists and does not belong to this organization. Invite or import it first.',
    'TOKEN_EXCHANGE_USER_NOT_IN_ORG',
    403
  );
}

/**
 * Exchange a JWT token for a user and org. Verifies signature with org's signing secret,
 * finds or creates user, ensures org membership. Caller is responsible for creating session and setting cookie.
 */
export async function exchangeToken(
  token: string,
  authApi: {
    signUpEmail: (args: { body: { name: string; email: string; password: string } }) => Promise<{ user: User }>;
  }
): Promise<{ user: User; orgId: string }> {
  const configs = await getAllActiveTokenAuth();
  if (configs.length === 0) {
    throw new TokenExchangeError('No active token auth configured', 'TOKEN_EXCHANGE_NOT_ENABLED', 403);
  }

  let payload: unknown;
  let orgId: string | null = null;

  for (const config of configs) {
    const secret = new TextEncoder().encode(config.signingSecret);
    try {
      const { payload: verified } = await jwtVerify(token, secret, {
        algorithms: ['HS256'],
        maxTokenAge: MAX_TOKEN_AGE_SEC
      });
      payload = verified;
      orgId = config.organizationId;
      break;
    } catch {
      continue;
    }
  }

  if (!orgId) {
    throw new TokenExchangeError('Invalid token', 'TOKEN_EXCHANGE_INVALID_TOKEN', 400);
  }

  const parsed = ZTokenExchangePayload.safeParse(payload);
  if (!parsed.success) {
    throw new TokenExchangeError('Invalid token payload', 'TOKEN_EXCHANGE_INVALID_TOKEN', 400);
  }

  const { email, name, avatar } = parsed.data;
  const emailLower = email.toLowerCase();

  const [existingUser] = await db.select().from(schema.user).where(eq(schema.user.email, emailLower)).limit(1);

  let user: User;
  if (existingUser) {
    await assertTokenMayClaim(existingUser.id, existingUser.role, emailLower, orgId);
    user = existingUser as User;
  } else {
    const randomPassword = crypto.randomUUID() + crypto.randomUUID();
    const signUpBody: { name: string; email: string; password: string; image?: string } = {
      name: name ?? emailLower.split('@')[0],
      email: emailLower,
      password: randomPassword
    };
    if (avatar) signUpBody.image = avatar;
    const result = await authApi.signUpEmail({
      body: signUpBody
    });
    user = result.user;
  }

  await ensureOrgMembership(user.id, user.email ?? emailLower, orgId);

  if (avatar) {
    await db
      .update(schema.profile)
      .set({ avatarUrl: avatar, updatedAt: new Date().toISOString() })
      .where(eq(schema.profile.id, user.id));
  }

  return {
    user: {
      ...user,
      image: user.image ?? null
    },
    orgId
  };
}
