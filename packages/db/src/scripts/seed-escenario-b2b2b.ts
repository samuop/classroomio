import 'dotenv/config';

import * as schema from '../schema';
import bcrypt from 'bcrypt';
import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';

/**
 * Escenario de prueba B2B2B para la base LOCAL.
 *
 * Arma la jerarquía completa —consultora, dos empresas cliente, y una persona
 * por cada nivel de acceso— para poder comprobar a mano lo que ningún test
 * unitario prueba: qué ve cada uno cuando entra.
 *
 *   Consultora Demo            ← admin: consultora@local.test
 *   ├── Cliente Norte          ← admin: norte@local.test
 *   └── Cliente Sur
 *
 * Más un tutor de la consultora (que NO debe heredar nada) y una alumna de
 * Cliente Norte, inscripta en un curso publicado con la plantilla `diploma` y
 * las dos marcas ya cargadas.
 *
 * Todas las contraseñas son la misma y están impresas al final: es una base de
 * desarrollo y el objetivo es entrar rápido con cada usuario.
 *
 * Es IDEMPOTENTE: volver a correrlo no duplica nada.
 *
 * NO CORRER CONTRA PRODUCCIÓN. Comprueba que la base sea local y aborta si no.
 *
 * Uso:
 *   pnpm --filter @cio/db seed:b2b2b
 */

const CLAVE = 'prueba1234';
const BCRYPT_COST = 10;
const ROLE = { ADMIN: 1, TUTOR: 2, STUDENT: 3 } as const;

const connectionString = process.env.DATABASE_URL ?? process.env.PRIVATE_DATABASE_URL ?? '';

if (!connectionString) {
  console.error('DATABASE_URL es requerido');
  process.exit(1);
}

// La red de seguridad que importa: este script escribe usuarios con una
// contraseña conocida y publicada. Corrido contra la base equivocada, eso es un
// incidente, no un traspié.
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(connectionString)) {
  console.error('❌ Esta base NO parece local. Abortado.');
  console.error('   El script crea usuarios con una contraseña conocida; solo tiene sentido en desarrollo.');
  process.exit(1);
}

const client = postgres(connectionString, { max: 1 });
const db = drizzle(client, { schema });

/** Un usuario que puede entrar: user + profile + credencial. Idempotente. */
async function asegurarUsuario(email: string, nombre: string, hash: string): Promise<string> {
  const ahora = new Date();

  let [usuario] = await db.select().from(schema.user).where(eq(schema.user.email, email)).limit(1);

  if (!usuario) {
    [usuario] = await db
      .insert(schema.user)
      .values({
        id: randomUUID(),
        name: nombre,
        email,
        emailVerified: true,
        createdAt: ahora,
        updatedAt: ahora
      } as typeof schema.user.$inferInsert)
      .returning();
  }

  const [credencial] = await db
    .select()
    .from(schema.account)
    .where(and(eq(schema.account.userId, usuario!.id), eq(schema.account.providerId, 'credential')))
    .limit(1);

  if (credencial) {
    await db.update(schema.account).set({ password: hash, updatedAt: ahora }).where(eq(schema.account.id, credencial.id));
  } else {
    await db.insert(schema.account).values({
      id: randomUUID(),
      accountId: usuario!.id,
      providerId: 'credential',
      userId: usuario!.id,
      password: hash,
      createdAt: ahora,
      updatedAt: ahora
    } as typeof schema.account.$inferInsert);
  }

  let [perfil] = await db.select().from(schema.profile).where(eq(schema.profile.email, email)).limit(1);

  if (perfil) {
    // Ver la nota de abajo: hay DOS banderas de verificación y esta es la que
    // mira la aplicación. Se reescribe siempre, para arreglar de paso los
    // perfiles que dejó una corrida anterior del script.
    await db
      .update(schema.profile)
      .set({ isEmailVerified: true, verifiedAt: ahora.toISOString() })
      .where(eq(schema.profile.id, perfil.id));
  }

  if (!perfil) {
    // `profile.id` es clave foránea de `user.id`: el perfil NO tiene identidad
    // propia, es la cara de un usuario dentro de la aplicación. Con un uuid
    // nuevo el insert falla, y el mensaje de error no dice por qué.
    [perfil] = await db
      .insert(schema.profile)
      .values({
        id: usuario!.id,
        fullname: nombre,
        email,
        username: email.split('@')[0],
        // Hay DOS banderas de verificación en tablas distintas: `user.emailVerified`
        // es la de better-auth y no basta — la aplicación levanta el cartel de
        // "verificá tu correo" mirando ESTA. Poner solo la otra deja al usuario
        // adentro pero con un modal encima que no puede cerrar.
        isEmailVerified: true,
        verifiedAt: ahora.toISOString(),
        createdAt: ahora.toISOString()
      } as unknown as typeof schema.profile.$inferInsert)
      .returning();
  }

  return perfil!.id;
}

async function asegurarMiembro(orgId: string, profileId: string, email: string, roleId: number) {
  const [existente] = await db
    .select()
    .from(schema.organizationmember)
    .where(and(eq(schema.organizationmember.organizationId, orgId), eq(schema.organizationmember.profileId, profileId)))
    .limit(1);

  if (existente) {
    await db
      .update(schema.organizationmember)
      .set({ roleId })
      .where(eq(schema.organizationmember.id, existente.id));
    return existente.id;
  }

  const [creado] = await db
    .insert(schema.organizationmember)
    .values({
      organizationId: orgId,
      profileId,
      email,
      roleId,
      verified: true,
      createdAt: new Date().toISOString()
    } as unknown as typeof schema.organizationmember.$inferInsert)
    .returning();

  return creado!.id;
}

async function asegurarOrg(nombre: string, slug: string, parentId: string | null, planName: string) {
  const [existente] = await db
    .select()
    .from(schema.organization)
    .where(eq(schema.organization.siteName, slug))
    .limit(1);

  if (existente) return existente;

  const [creada] = await db
    .insert(schema.organization)
    .values({
      id: randomUUID(),
      name: nombre,
      siteName: slug,
      theme: 'blue',
      settings: { signup: { inviteOnly: true } },
      isRestricted: false,
      createdAt: new Date().toISOString(),
      ...(parentId ? { parentOrganizationId: parentId } : {})
    } as unknown as typeof schema.organization.$inferInsert)
    .returning();

  // Mismo plan que le da `createSecondaryWorkspace` a una empresa hija: sin
  // plan propio la empresa nace sin cupo de fichas y con funciones capadas, y
  // parece rota desde el primer minuto.
  await db.insert(schema.organizationPlan).values({
    orgId: creada!.id,
    planName,
    subscriptionId: `seed-${creada!.id}`,
    payload: parentId ? { inheritedFrom: parentId } : { seeded: true },
    isActive: true,
    provider: parentId ? 'parent-workspace' : 'seed'
  } as typeof schema.organizationPlan.$inferInsert);

  return creada!;
}

async function main() {
  const hash = await bcrypt.hash(CLAVE, BCRYPT_COST);
  const ahora = new Date().toISOString();

  const personas = {
    consultora: await asegurarUsuario('consultora@local.test', 'Erica Demo (consultora)', hash),
    norte: await asegurarUsuario('norte@local.test', 'Nadia Norte (admin cliente)', hash),
    tutor: await asegurarUsuario('tutor@local.test', 'Tomás Tutor (consultora)', hash),
    // El tutor de la empresa cliente es gente DE LA EMPRESA CLIENTE, no de la
    // consultora: da clase en su propia empresa y no debe ver a las hermanas.
    // Es el par que hace falta para notar la diferencia con el otro tutor.
    tutorNorte: await asegurarUsuario('tutor-norte@local.test', 'Tania Tutora (Cliente Norte)', hash),
    alumna: await asegurarUsuario('alumna@local.test', 'Ana Gómez Ferreyra', hash)
  };

  const consultora = await asegurarOrg('Consultora Demo', 'consultora-demo', null, 'ENTERPRISE');
  const norte = await asegurarOrg('Cliente Norte', 'cliente-norte', consultora.id, 'ENTERPRISE');
  const sur = await asegurarOrg('Cliente Sur', 'cliente-sur', consultora.id, 'ENTERPRISE');

  await asegurarMiembro(consultora.id, personas.consultora, 'consultora@local.test', ROLE.ADMIN);
  await asegurarMiembro(consultora.id, personas.tutor, 'tutor@local.test', ROLE.TUTOR);
  await asegurarMiembro(norte.id, personas.norte, 'norte@local.test', ROLE.ADMIN);
  await asegurarMiembro(norte.id, personas.tutorNorte, 'tutor-norte@local.test', ROLE.TUTOR);
  await asegurarMiembro(norte.id, personas.alumna, 'alumna@local.test', ROLE.STUDENT);

  // ── Un curso en Cliente Norte, publicado y con el certificado nuevo ──────
  const [grupoExistente] = await db
    .select()
    .from(schema.group)
    .where(and(eq(schema.group.organizationId, norte.id), eq(schema.group.name, 'Seguridad e Higiene')))
    .limit(1);

  const grupo =
    grupoExistente ??
    (
      await db
        .insert(schema.group)
        .values({
          id: randomUUID(),
          name: 'Seguridad e Higiene',
          organizationId: norte.id,
          createdAt: ahora
        } as unknown as typeof schema.group.$inferInsert)
        .returning()
    )[0]!;

  const certificado = {
    isDownloadable: true,
    design: {
      templateId: 'diploma',
      accentColor: '#8a6d3b',
      subtitle: 'Certificado de aprobación',
      signatories: [
        { name: 'A. Fernández', role: 'Dirección académica' },
        { name: 'M. Rossi', role: 'Instructor' }
      ],
      idFormat: 'N° {seq}',
      // Las dos marcas: la consultora que dicta y la empresa que la recibe.
      // Sin logos todavía — se suben desde el editor, que es justamente lo que
      // hay que probar a mano.
      orgBrand: { name: 'Consultora Demo' },
      clientBrand: { name: 'Cliente Norte' },
      brandShowNames: true
    }
  };

  const [cursoExistente] = await db
    .select()
    .from(schema.course)
    .where(and(eq(schema.course.groupId, grupo.id), eq(schema.course.title, 'Seguridad e Higiene en Planta · Nivel I')))
    .limit(1);

  const curso =
    cursoExistente ??
    (
      await db
        .insert(schema.course)
        .values({
          id: randomUUID(),
          title: 'Seguridad e Higiene en Planta · Nivel I',
          description: '40 horas, con evaluación final aprobada.',
          groupId: grupo.id,
          isPublished: true,
          status: 'ACTIVE',
          slug: `seguridad-higiene-${Date.now()}`,
          certificate: certificado,
          createdAt: ahora
        } as unknown as typeof schema.course.$inferInsert)
        .returning()
    )[0]!;

  // El diseño se reescribe siempre: si el curso ya existía de una corrida
  // previa, lo que interesa es que quede con la plantilla que se va a probar.
  await db.update(schema.course).set({ certificate: certificado, isPublished: true }).where(eq(schema.course.id, curso.id));

  // La alumna y la tutora del curso. Ser TUTOR de la empresa no alcanza para
  // dar ESTE curso: el equipo del curso es una membresía aparte, así que hay
  // que sumarla acá o la tutora entra a la empresa y no ve el curso por dentro.
  for (const [profileId, roleId] of [
    [personas.alumna, ROLE.STUDENT],
    [personas.tutorNorte, ROLE.TUTOR]
  ] as const) {
    const [existente] = await db
      .select()
      .from(schema.groupmember)
      .where(and(eq(schema.groupmember.groupId, grupo.id), eq(schema.groupmember.profileId, profileId)))
      .limit(1);

    if (!existente) {
      await db.insert(schema.groupmember).values({
        id: randomUUID(),
        groupId: grupo.id,
        profileId,
        roleId,
        createdAt: ahora
      } as unknown as typeof schema.groupmember.$inferInsert);
    }
  }

  console.log('\n✅ Escenario listo. Entrá en http://localhost:5173/login\n');
  console.log(`   Contraseña para todos: ${CLAVE}\n`);
  console.log('   consultora@local.test   ADMIN de Consultora Demo');
  console.log('                           → debe ver "Clientes" y poder entrar a Norte y Sur');
  console.log('   norte@local.test        ADMIN de Cliente Norte');
  console.log('                           → NO debe ver Cliente Sur ni la consultora');
  console.log('   tutor@local.test        TUTOR de Consultora Demo');
  console.log('                           → NO debe heredar acceso a ninguna empresa cliente');
  console.log('   tutor-norte@local.test  TUTOR de Cliente Norte (y del curso)');
  console.log('                           → da su curso; NO debe ver Cliente Sur ni "Clientes"');
  console.log('   alumna@local.test       ALUMNA en Cliente Norte');
  console.log('                           → debe ver el LMS, no el panel\n');
  console.log('   Curso con el certificado nuevo: "Seguridad e Higiene en Planta · Nivel I"');
  console.log('   (Cliente Norte → Certificados → plantilla Diploma, con las dos marcas)\n');
}

main()
  .catch((error) => {
    console.error('❌ Error:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => client.end());
