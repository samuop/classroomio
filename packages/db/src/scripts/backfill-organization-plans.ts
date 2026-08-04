/**
 * Gives every organization an active plan row, so turning multitenancy on does
 * not silently downgrade the whole install.
 *
 * `PUBLIC_IS_SELFHOSTED=true` short-circuits plan checks — `isOrgOnPaidPlan`
 * returns true without ever reading the database. The day that flag goes off (it
 * has to, for tenant resolution to run at all: see `getOrgSiteInfo`), the checks
 * start reading `organization_plan` for real, and `getPlanAllowance` answers
 * BASIC for any org with no row. On this deployment that table is EMPTY, so
 * every org would drop to the free plan at once — agent document uploads
 * refused, premium question types filtered out, `isEnterprisePlan` flipping from
 * a hardcoded true to false.
 *
 * Nothing here changes behaviour while the flag is on; it makes the flag safe to
 * turn off. Idempotent: an org that already has an active plan is left alone, so
 * re-running is a no-op and no paying customer is overwritten.
 *
 *   pnpm --filter @cio/db db:plans-backfill                            # dry run
 *   pnpm --filter @cio/db db:plans-backfill --execute
 *   pnpm --filter @cio/db db:plans-backfill --execute --plan=EARLY_ADOPTER
 *   pnpm --filter @cio/db db:plans-backfill --execute --upgrade-basic  # also lift active BASIC rows
 *
 * An org sitting on an ACTIVE BASIC row is downgraded by the flag flip just as
 * surely as one with no row at all — this install has both. Lifting it is still
 * opt-in (`--upgrade-basic`), because overwriting somebody's real plan is not
 * something a backfill should decide on its own.
 */
import * as schema from '../schema';

import { and, db, eq } from '../drizzle';

const args = process.argv.slice(2);
const flags = new Set(args);
const shouldExecute = flags.has('--execute');
const shouldUpgradeBasic = flags.has('--upgrade-basic');

const PLAN_NAMES = ['BASIC', 'EARLY_ADOPTER', 'ENTERPRISE'] as const;
type PlanName = (typeof PLAN_NAMES)[number];

function resolvePlan(): PlanName {
  const raw = args.find((a) => a.startsWith('--plan='))?.split('=')[1]?.toUpperCase();

  if (!raw) return 'ENTERPRISE';

  if (!(PLAN_NAMES as readonly string[]).includes(raw)) {
    console.error(`Unknown plan "${raw}". Valid: ${PLAN_NAMES.join(', ')}`);
    process.exit(1);
  }

  return raw as PlanName;
}

async function main() {
  const planName = resolvePlan();

  const organizations = await db
    .select({ id: schema.organization.id, name: schema.organization.name })
    .from(schema.organization);

  if (organizations.length === 0) {
    console.log('No organizations found — nothing to do.');
    return;
  }

  const missing: { id: string; name: string | null }[] = [];
  const toUpgrade: { planId: number; id: string; name: string | null; from: string }[] = [];

  for (const org of organizations) {
    const [active] = await db
      .select({ id: schema.organizationPlan.id, planName: schema.organizationPlan.planName })
      .from(schema.organizationPlan)
      .where(and(eq(schema.organizationPlan.orgId, org.id), eq(schema.organizationPlan.isActive, true)))
      .limit(1);

    if (!active) {
      missing.push(org);
      continue;
    }

    if (active.planName === 'BASIC' && planName !== 'BASIC' && shouldUpgradeBasic) {
      toUpgrade.push({ planId: active.id, id: org.id, name: org.name, from: active.planName });
      continue;
    }

    const note =
      active.planName === 'BASIC' && planName !== 'BASIC'
        ? ' — pass --upgrade-basic to lift it'
        : '';

    console.log(`  = ${org.name ?? org.id} — already on ${active.planName}, left alone${note}`);
  }

  if (missing.length === 0 && toUpgrade.length === 0) {
    console.log('\nEvery organization already has an active plan. Nothing to do.');
    return;
  }

  for (const org of missing) {
    console.log(`  + ${org.name ?? org.id} → ${planName}`);
  }

  for (const org of toUpgrade) {
    console.log(`  ↑ ${org.name ?? org.id} — ${org.from} → ${planName}`);
  }

  if (!shouldExecute) {
    console.log('\nDry run. Re-run with --execute to apply.');
    return;
  }

  for (const org of toUpgrade) {
    await db
      .update(schema.organizationPlan)
      .set({ planName, updatedAt: new Date().toISOString() })
      .where(eq(schema.organizationPlan.id, org.planId));

    console.log(`  ✓ ${org.name ?? org.id} (upgraded)`);
  }

  for (const org of missing) {
    // `id` is an identity column — let the database allocate it. Computing it
    // as MAX(id)+1 is exactly the pattern that produced duplicate-key failures
    // in the exercise tables when two writers raced.
    await db.insert(schema.organizationPlan).values({
      orgId: org.id,
      planName,
      isActive: true,
      provider: 'manual'
    });

    console.log(`  ✓ ${org.name ?? org.id}`);
  }

  console.log(`\nDone. ${missing.length} row(s) written, ${toUpgrade.length} upgraded.`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('backfill-organization-plans failed:', error);
    process.exit(1);
  });
