/**
 * El token de una empresa sólo reclama identidades de ESA empresa.
 *
 * `exchangeToken` buscaba el correo del token en TODA la base y, si el usuario
 * existía, le abría sesión. Como el secreto de firma lo genera y lo ve el admin
 * de cada empresa cliente desde su propia pantalla, eso convertía ese secreto en
 * una llave maestra: firmar un token con el correo del operador de la plataforma
 * devolvía su sesión, y con ella todas las empresas.
 *
 * Contra Postgres de verdad y no con mocks, porque lo que decide es una consulta:
 * qué cuenta a la ojos de la base pertenece a qué empresa. El JWT se firma a mano
 * (HS256 con node:crypto) para que el test no dependa de la librería que valida.
 *
 * Se corren con `pnpm --filter @cio/api test:db`.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHmac, randomUUID } from 'node:crypto';

import { PLATFORM_ROLE, ROLE } from '@cio/utils/constants';
import {
  db,
  eq,
  inArray,
  organization,
  organizationInvite,
  organizationTokenAuth,
  organizationmember,
  profile,
  user
} from '@cio/db/drizzle';
import { TokenExchangeError, exchangeToken } from '@cio/db/auth/token-exchange';

const RUN = randomUUID().slice(0, 8);
const correo = (quien: string) => `${quien}-${RUN}@test.local`;

const EMPRESA_A = randomUUID();
const EMPRESA_B = randomUUID();
const SECRETO_A = `secreto-a-${RUN}-${randomUUID()}`;
const SECRETO_B = `secreto-b-${RUN}-${randomUUID()}`;

const OPERADOR = randomUUID();
const MIEMBRO_A = randomUUID();
const ALUMNO_B = randomUUID();
const AJENO = randomUUID();
const INVITADO = randomUUID();
const IMPORTADO = randomUUID();
const PERSONAS = [OPERADOR, MIEMBRO_A, ALUMNO_B, AJENO, INVITADO, IMPORTADO];

/** Los que cree el alta durante la corrida, para poder borrarlos después. */
const creados: string[] = [];
const altas: string[] = [];

const authApi = {
  signUpEmail: async ({ body }: { body: { name: string; email: string; password: string } }) => {
    altas.push(body.email);
    const id = randomUUID();
    creados.push(id);

    await db.insert(user).values({ id, name: body.name, email: body.email });
    await db.insert(profile).values({
      id,
      fullname: body.name,
      username: `int-${RUN}-${id.slice(0, 8)}`,
      email: body.email
    });

    return {
      user: {
        id,
        name: body.name,
        email: body.email,
        emailVerified: false,
        image: null,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    } as never;
  }
};

function base64url(valor: object): string {
  return Buffer.from(JSON.stringify(valor)).toString('base64url');
}

function firmar(payload: Record<string, unknown>, secreto: string): string {
  const ahora = Math.floor(Date.now() / 1000);
  // `sub` es el id de la persona en el sistema del cliente, y `exp` lo exige
  // tanto el esquema del payload como el tope de 5 minutos del verificador.
  const cabecera = base64url({ alg: 'HS256', typ: 'JWT' });
  const cuerpo = base64url({ sub: `externo-${RUN}`, iat: ahora, exp: ahora + 120, ...payload });
  const datos = `${cabecera}.${cuerpo}`;
  const firma = createHmac('sha256', secreto).update(datos).digest('base64url');

  return `${datos}.${firma}`;
}

const tokenDeA = (email: string) => firmar({ email, name: 'Quien sea' }, SECRETO_A);

async function codigoDeError(promesa: Promise<unknown>): Promise<string> {
  try {
    await promesa;
    return '(no falló)';
  } catch (error) {
    return error instanceof TokenExchangeError ? error.code : `(otro error: ${String(error)})`;
  }
}

async function limpiar() {
  const todos = [...PERSONAS, ...creados];

  await db.delete(organizationInvite).where(inArray(organizationInvite.organizationId, [EMPRESA_A, EMPRESA_B]));
  await db.delete(organizationTokenAuth).where(inArray(organizationTokenAuth.organizationId, [EMPRESA_A, EMPRESA_B]));
  await db.delete(organizationmember).where(inArray(organizationmember.organizationId, [EMPRESA_A, EMPRESA_B]));
  await db.delete(organization).where(inArray(organization.id, [EMPRESA_A, EMPRESA_B]));
  await db.delete(profile).where(inArray(profile.id, todos));
  await db.delete(user).where(inArray(user.id, todos));
}

beforeAll(async () => {
  try {
    await db.select({ id: user.id }).from(user).limit(1);
  } catch (error) {
    throw new Error(
      'No se pudo hablar con Postgres. Levantá la base y sincronizá el schema:\n' +
        '  docker compose -f docker/docker-compose.yaml up -d postgres\n' +
        '  pnpm --filter @cio/db db:setup\n' +
        `Detalle: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  await db.insert(user).values([
    { id: OPERADOR, name: 'Operador', email: correo('operador'), role: PLATFORM_ROLE.ADMIN },
    { id: MIEMBRO_A, name: 'Miembro A', email: correo('miembro-a'), role: 'user' },
    { id: ALUMNO_B, name: 'Alumno B', email: correo('alumno-b'), role: 'user' },
    { id: AJENO, name: 'Ajeno', email: correo('ajeno'), role: 'user' },
    { id: INVITADO, name: 'Invitado', email: correo('invitado'), role: 'user' },
    { id: IMPORTADO, name: 'Importado', email: correo('importado'), role: 'user' }
  ]);
  await db.insert(profile).values(
    PERSONAS.map((id, i) => ({
      id,
      fullname: `Persona ${i}`,
      username: `int-${RUN}-p${i}`,
      email: `p${i}-${RUN}@test.local`
    }))
  );

  await db.insert(organization).values([
    { id: EMPRESA_A, name: `Empresa A ${RUN}`, siteName: `int-a-${RUN}` },
    { id: EMPRESA_B, name: `Empresa B ${RUN}`, siteName: `int-b-${RUN}` }
  ]);

  await db.insert(organizationTokenAuth).values([
    {
      organizationId: EMPRESA_A,
      signingSecret: SECRETO_A,
      isActive: true,
      createdByProfileId: MIEMBRO_A
    },
    // Inactiva a propósito: su secreto no tiene que servir para nada.
    {
      organizationId: EMPRESA_B,
      signingSecret: SECRETO_B,
      isActive: false,
      createdByProfileId: ALUMNO_B
    }
  ]);

  await db.insert(organizationmember).values([
    { organizationId: EMPRESA_A, profileId: MIEMBRO_A, roleId: ROLE.STUDENT, email: correo('miembro-a') },
    { organizationId: EMPRESA_B, profileId: ALUMNO_B, roleId: ROLE.STUDENT, email: correo('alumno-b') },
    // Lo que deja la importación de audiencia: correo sin perfil todavía.
    { organizationId: EMPRESA_A, profileId: null, roleId: ROLE.STUDENT, email: correo('importado') }
  ]);

  await db.insert(organizationInvite).values({
    organizationId: EMPRESA_A,
    roleId: ROLE.STUDENT,
    email: correo('invitado'),
    tokenHash: `hash-${RUN}`,
    createdByProfileId: MIEMBRO_A,
    expiresAt: new Date(Date.now() + 86_400_000).toISOString()
  });
});

afterAll(limpiar);

describe('lo que el token de una empresa NO puede reclamar', () => {
  it('una cuenta con rol global, aunque el token sea válido', async () => {
    expect(await codigoDeError(exchangeToken(tokenDeA(correo('operador')), authApi))).toBe(
      'TOKEN_EXCHANGE_PRIVILEGED_ACCOUNT'
    );
  });

  it('tampoco si el admin de la empresa le fabrica una fila de miembro con su correo', async () => {
    // Importar un correo a la audiencia lo puede hacer el admin de la empresa
    // solo. Si el chequeo de rol fuera después del de membresía, esto alcanzaría
    // para quedarse con la sesión del operador.
    await db.insert(organizationmember).values({
      organizationId: EMPRESA_A,
      profileId: OPERADOR,
      roleId: ROLE.ADMIN,
      email: correo('operador')
    });

    expect(await codigoDeError(exchangeToken(tokenDeA(correo('operador')), authApi))).toBe(
      'TOKEN_EXCHANGE_PRIVILEGED_ACCOUNT'
    );
  });

  it('la cuenta de un alumno de otra empresa', async () => {
    expect(await codigoDeError(exchangeToken(tokenDeA(correo('alumno-b')), authApi))).toBe(
      'TOKEN_EXCHANGE_USER_NOT_IN_ORG'
    );
  });

  it('una cuenta que existe y no tiene nada que ver con la empresa', async () => {
    expect(await codigoDeError(exchangeToken(tokenDeA(correo('ajeno')), authApi))).toBe(
      'TOKEN_EXCHANGE_USER_NOT_IN_ORG'
    );
  });

  it('nada, si el secreto es el de una configuración inactiva', async () => {
    const token = firmar({ email: correo('miembro-a'), name: 'Quien sea' }, SECRETO_B);

    expect(await codigoDeError(exchangeToken(token, authApi))).toBe('TOKEN_EXCHANGE_INVALID_TOKEN');
  });
});

describe('lo que sí sigue funcionando', () => {
  it('un miembro de la empresa entra', async () => {
    const { user: entrado, orgId } = await exchangeToken(tokenDeA(correo('miembro-a')), authApi);

    expect(entrado.id).toBe(MIEMBRO_A);
    expect(orgId).toBe(EMPRESA_A);
  });

  it('alguien importado a la audiencia, con la fila que todavía no tiene perfil', async () => {
    const { user: entrado } = await exchangeToken(tokenDeA(correo('importado')), authApi);

    expect(entrado.id).toBe(IMPORTADO);
  });

  it('alguien con una invitación abierta', async () => {
    const { user: entrado } = await exchangeToken(tokenDeA(correo('invitado')), authApi);

    expect(entrado.id).toBe(INVITADO);
  });

  it('una persona nueva se crea como siempre', async () => {
    const nuevo = correo('nuevo');

    const { user: entrado, orgId } = await exchangeToken(tokenDeA(nuevo), authApi);

    expect(altas).toContain(nuevo);
    expect(entrado.email).toBe(nuevo);
    expect(orgId).toBe(EMPRESA_A);
  });
});
