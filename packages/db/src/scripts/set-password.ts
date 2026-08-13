import 'dotenv/config';

// Relative, like generate-login-link.ts: this runs straight from a checkout on
// the server, where the `@db/*` alias depends on which tsconfig tsx happens to
// pick up from the working directory.
import * as schema from '../schema';
import bcrypt from 'bcrypt';
import { and, eq } from 'drizzle-orm';
import { randomInt, randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';

/**
 * Sets the password of an EXISTING user, without sending any email.
 *
 * For handing someone their credentials in person — onboarding a client admin,
 * or recovering an account whose password nobody wrote down. The alternative,
 * "forgot my password", mails a link to that person's inbox, which is the wrong
 * shape when you are about to demo the system to them face to face.
 *
 * It hashes with bcrypt at cost 10 because that is what this deployment's
 * better-auth config uses for both hash and verify (packages/db/src/auth/
 * email-password.ts). Better-auth's own default is scrypt: a hash written with
 * the wrong algorithm is accepted by the database and then fails every login
 * attempt with "invalid credentials", which looks like a typo rather than a
 * broken hash.
 *
 * Never creates a user. If the address has no account, that is worth knowing
 * rather than silently papering over with a new one.
 *
 * Usage:
 *   tsx src/scripts/set-password.ts --email someone@example.com [--password 'secret']
 *
 * With no --password it generates a temporary one and prints it.
 */

const BCRYPT_COST = 10;
/** No 0/O/1/l/I: these get read aloud and written down. */
const ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

function generatePassword(): string {
  const chunk = () =>
    Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
  return `${chunk()}-${chunk()}-${chunk()}`;
}

async function main() {
  const email = arg('--email')?.trim().toLowerCase();
  const password = arg('--password') ?? generatePassword();
  const generated = !arg('--password');

  if (!email) {
    console.error('Required: --email <address> [--password <secret>]');
    process.exit(1);
  }

  const connectionString = process.env.DATABASE_URL ?? process.env.PRIVATE_DATABASE_URL ?? '';
  if (!connectionString) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }

  const client = postgres(connectionString, { max: 1 });
  const db = drizzle(client, { schema });

  try {
    const [user] = await db.select().from(schema.user).where(eq(schema.user.email, email)).limit(1);

    if (!user) {
      console.error(`No user with that email: ${email}`);
      process.exit(1);
    }

    const hashed = await bcrypt.hash(password, BCRYPT_COST);
    const now = new Date();

    const [credential] = await db
      .select()
      .from(schema.account)
      .where(and(eq(schema.account.userId, user.id), eq(schema.account.providerId, 'credential')))
      .limit(1);

    if (credential) {
      await db
        .update(schema.account)
        .set({ password: hashed, updatedAt: now })
        .where(eq(schema.account.id, credential.id));
    } else {
      // Signed up through Google, or created by a flow that never set one.
      // Adding the credential row leaves the other sign-in method working.
      await db.insert(schema.account).values({
        id: randomUUID(),
        accountId: user.id,
        providerId: 'credential',
        userId: user.id,
        password: hashed,
        createdAt: now,
        updatedAt: now
      } as typeof schema.account.$inferInsert);
    }

    console.log('Password updated.');
    console.log('  email:   ', email);
    console.log('  password:', password);
    if (generated) {
      console.log('\nTemporary — have them change it from their profile after signing in.');
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error('set-password error:', error instanceof Error ? error.message : error);
  process.exit(1);
});
