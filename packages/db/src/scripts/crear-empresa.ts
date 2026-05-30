import 'dotenv/config';

import * as schema from '@db/schema';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';

/**
 * Crea una EMPRESA (organización) nueva y la asocia a un usuario que YA EXISTE
 * como administrador. Pensado para el modelo multi-organización: la consultora
 * administra varias empresas, cada una aislada en su propia organización.
 *
 * - La org queda en español, con signup `inviteOnly` (nadie se registra solo;
 *   el referente invita a sus alumnos).
 * - Si pasás --admin-email de un usuario inexistente, falla (usá create-admin
 *   para crear un usuario nuevo desde cero).
 *
 * Uso:
 *   tsx src/scripts/crear-empresa.ts \
 *     --org 'Globex' --slug globex \
 *     --admin-email samuelocta215@gmail.com
 */

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

const orgName = arg('--org');
const adminEmail = arg('--admin-email');
const slug = (arg('--slug') ?? orgName ?? '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '');

if (!orgName || !adminEmail) {
  console.error('Requerido: --org y --admin-email');
  process.exit(1);
}

const connectionString = process.env.DATABASE_URL ?? process.env.PRIVATE_DATABASE_URL ?? '';
if (!connectionString) {
  console.error('DATABASE_URL es requerido');
  process.exit(1);
}

const ROLE_ADMIN = 1;

const DEFAULT_CUSTOMIZATION = {
  apps: { poll: true, comments: true },
  course: { grading: true, newsfeed: true },
  dashboard: { exercise: true, community: true, bannerText: '', bannerImage: '' }
};

const DEFAULT_AI_TUTOR = {
  enabled: true,
  persona: 'encouraging',
  codePolicy: 'hints_only',
  escalation: { email: '', enabled: false },
  thingsToSay: '',
  blockOffTopic: true,
  customPersona: '',
  assessmentMode: 'hint_only',
  groundingScope: 'course',
  responseLength: 'medium',
  thingsNotToSay: '',
  welcomeMessage: '',
  forbiddenTopics: [],
  profanityFilter: true,
  disclaimerFooter: 'Soy un tutor de IA, no tu instructor.',
  requireCitations: true,
  revealSolutionsAfterAttempts: 3
};

// inviteOnly: nadie se registra solo; el referente/admin invita a los alumnos.
const ORG_SETTINGS = { signup: { inviteOnly: true } };

async function main() {
  const client = postgres(connectionString, { max: 1 });
  const db = drizzle(client, { schema });

  const now = new Date();
  const nowIso = now.toISOString();

  try {
    // 1. Buscar el usuario admin existente (por email) vía su profile.
    const [adminProfile] = await db
      .select()
      .from(schema.profile)
      .where(eq(schema.profile.email, adminEmail!))
      .limit(1);

    if (!adminProfile) {
      console.error(`❌ No existe un usuario con email ${adminEmail}.`);
      console.error('   Usá create-admin para crear un usuario nuevo, o verificá el email.');
      process.exit(1);
    }

    // 2. Evitar slug duplicado.
    const [existingOrg] = await db
      .select()
      .from(schema.organization)
      .where(eq(schema.organization.siteName, slug))
      .limit(1);

    if (existingOrg) {
      console.error(`❌ Ya existe una organización con slug "${slug}". Elegí otro --slug.`);
      process.exit(1);
    }

    const orgId = randomUUID();

    // 3. Crear la organización.
    await db.insert(schema.organization).values({
      id: orgId,
      name: orgName,
      siteName: slug,
      theme: 'blue',
      customization: DEFAULT_CUSTOMIZATION,
      aiTutorSettings: DEFAULT_AI_TUTOR,
      settings: ORG_SETTINGS,
      isRestricted: false,
      createdAt: nowIso
    } as unknown as typeof schema.organization.$inferInsert);

    // 4. Asociar al admin existente.
    await db.insert(schema.organizationmember).values({
      organizationId: orgId,
      roleId: ROLE_ADMIN,
      profileId: adminProfile.id,
      email: adminEmail!,
      verified: true,
      createdAt: nowIso
    } as unknown as typeof schema.organizationmember.$inferInsert);

    console.log('✅ Empresa creada:');
    console.log('   empresa:', orgName, `(slug: ${slug})`);
    console.log('   admin:  ', adminEmail);
    console.log('   modo:   ', 'inviteOnly (solo invitación)');
    console.log('');
    console.log('   Local:   localhost:5173/?org=' + slug);
    console.log('   Prod:    ' + slug + '.<tu-dominio>');
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error('❌ Error creando empresa:', e);
  process.exit(1);
});
