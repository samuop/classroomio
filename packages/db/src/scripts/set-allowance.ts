import 'dotenv/config';

import * as schema from '@db/schema';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq, and } from 'drizzle-orm';

/**
 * Set the monthly AI token allowance for an organization (operator tool).
 *
 * Usage:
 *   tsx src/scripts/set-allowance.ts --org tensor-tech --tokens 2000000
 *   tsx src/scripts/set-allowance.ts --org tensor-tech --tokens 0   (disable AI for the org)
 *   tsx src/scripts/set-allowance.ts --list                          (show all orgs + allowance)
 */

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

const connectionString = process.env.DATABASE_URL ?? process.env.PRIVATE_DATABASE_URL ?? '';
if (!connectionString) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const DEFAULT_ALLOWANCES: Record<string, number> = {
  BASIC: 500_000,
  EARLY_ADOPTER: 3_000_000,
  ENTERPRISE: 15_000_000
};

async function main() {
  const client = postgres(connectionString, { max: 1 });
  const db = drizzle(client, { schema });

  try {
    // --list: show every org and its effective allowance
    if (process.argv.includes('--list')) {
      const orgs = await db.select().from(schema.organization);
      const plans = await db.select().from(schema.organizationPlan).where(eq(schema.organizationPlan.isActive, true));
      console.log('\nOrg (slug)                    | plan        | allowance/mes');
      console.log('------------------------------|-------------|---------------');
      for (const o of orgs) {
        const plan = plans.find((p) => p.orgId === o.id);
        const payload = (plan?.payload ?? null) as Record<string, unknown> | null;
        const custom = payload?.aiTokenAllowance as number | undefined;
        const planName = plan?.planName ?? 'BASIC (default)';
        const allowance = custom ?? DEFAULT_ALLOWANCES[plan?.planName ?? 'BASIC'] ?? 0;
        const name = `${o.name} (${o.siteName ?? '-'})`.padEnd(29).slice(0, 29);
        console.log(`${name} | ${planName.padEnd(11).slice(0, 11)} | ${allowance.toLocaleString()}`);
      }
      console.log('');
      return;
    }

    const slug = arg('--org');
    const tokensRaw = arg('--tokens');
    if (!slug || tokensRaw === undefined) {
      console.error('Usage: --org <slug> --tokens <number>   |   --list');
      process.exit(1);
    }
    const tokens = Number(tokensRaw);
    if (!Number.isFinite(tokens) || tokens < 0) {
      console.error('--tokens must be a non-negative number');
      process.exit(1);
    }

    const [org] = await db.select().from(schema.organization).where(eq(schema.organization.siteName, slug)).limit(1);
    if (!org) {
      console.error(`Org with siteName "${slug}" not found. Use --list to see options.`);
      process.exit(1);
    }

    const [existing] = await db
      .select()
      .from(schema.organizationPlan)
      .where(and(eq(schema.organizationPlan.orgId, org.id), eq(schema.organizationPlan.isActive, true)))
      .limit(1);

    const nowIso = new Date().toISOString();

    if (existing) {
      const payload = { ...((existing.payload as Record<string, unknown>) ?? {}), aiTokenAllowance: tokens };
      await db
        .update(schema.organizationPlan)
        .set({ payload, updatedAt: nowIso })
        .where(eq(schema.organizationPlan.id, existing.id));
    } else {
      await db.insert(schema.organizationPlan).values({
        orgId: org.id,
        planName: 'BASIC',
        isActive: true,
        activatedAt: nowIso,
        updatedAt: nowIso,
        payload: { aiTokenAllowance: tokens },
        provider: 'manual'
      } as unknown as typeof schema.organizationPlan.$inferInsert);
    }

    console.log(`✅ ${org.name} (${slug}): allowance de IA = ${tokens.toLocaleString()} tokens/mes`);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error('❌ Error:', e);
  process.exit(1);
});
