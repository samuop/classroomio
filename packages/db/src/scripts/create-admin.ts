import 'dotenv/config';

import * as schema from '@db/schema';
import bcrypt from 'bcrypt';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';

/**
 * Creates a single admin user + organization on a clean database.
 * Run AFTER db:reset + essential seed (roles/question-types/submissions).
 *
 * Usage:
 *   tsx src/scripts/create-admin.ts \
 *     --email you@example.com --password 'secret' \
 *     --name 'Your Name' --org 'My Org' --slug my-org
 */

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

const email = arg('--email');
const password = arg('--password');
const name = arg('--name') ?? 'Admin';
const orgName = arg('--org') ?? 'My Organization';
const slug = (arg('--slug') ?? orgName).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

if (!email || !password) {
  console.error('Required: --email and --password');
  process.exit(1);
}

const connectionString = process.env.DATABASE_URL ?? process.env.PRIVATE_DATABASE_URL ?? '';
if (!connectionString) {
  console.error('DATABASE_URL is required');
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
  disclaimerFooter: 'I am an AI tutor, not your instructor.',
  requireCitations: true,
  revealSolutionsAfterAttempts: 3
};

async function main() {
  const client = postgres(connectionString, { max: 1 });
  const db = drizzle(client, { schema });

  const userId = randomUUID();
  const orgId = randomUUID();
  const now = new Date();
  const nowIso = now.toISOString();
  const username = email!.split('@')[0];
  const hashed = await bcrypt.hash(password!, 10);

  try {
    // 1. Better Auth user
    await db.insert(schema.user).values({
      id: userId,
      name,
      email: email!,
      emailVerified: true,
      createdAt: now,
      updatedAt: now
    } as typeof schema.user.$inferInsert);

    // 2. credential account (email/password)
    await db.insert(schema.account).values({
      id: randomUUID(),
      accountId: userId,
      providerId: 'credential',
      userId,
      password: hashed,
      createdAt: now,
      updatedAt: now
    } as typeof schema.account.$inferInsert);

    // 3. profile (same id as user)
    await db.insert(schema.profile).values({
      id: userId,
      fullname: name,
      username,
      email: email!,
      isEmailVerified: true,
      verifiedAt: nowIso,
      locale: 'es',
      canAddCourse: true,
      isRestricted: false
    } as typeof schema.profile.$inferInsert);

    // 4. organization
    await db.insert(schema.organization).values({
      id: orgId,
      name: orgName,
      siteName: slug,
      theme: 'blue',
      customization: DEFAULT_CUSTOMIZATION,
      aiTutorSettings: DEFAULT_AI_TUTOR,
      settings: {},
      isRestricted: false,
      createdAt: nowIso
    } as unknown as typeof schema.organization.$inferInsert);

    // 5. org membership as ADMIN
    await db.insert(schema.organizationmember).values({
      organizationId: orgId,
      roleId: ROLE_ADMIN,
      profileId: userId,
      email: email!,
      verified: true,
      createdAt: nowIso
    } as unknown as typeof schema.organizationmember.$inferInsert);

    console.log('✅ Admin creado:');
    console.log('   email:', email);
    console.log('   org:  ', orgName, `(slug: ${slug})`);
    console.log('   role: ADMIN');
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error('❌ Error creando admin:', e);
  process.exit(1);
});
