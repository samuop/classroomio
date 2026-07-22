import * as schema from '@db/schema';

import { and, asc, count, desc, eq, gte, ilike, or, sql, sum } from 'drizzle-orm';

import type { TOrganization } from '@db/types';
import { db } from '@db/drizzle';

export interface PlatformOrgListItem {
  id: string;
  name: string;
  siteName: string | null;
  avatarUrl: string | null;
  createdAt: string;
  isRestricted: boolean;
  readOnlyUntil: string | null;
  customDomain: string | null;
  isCustomDomainVerified: boolean | null;
  planName: string | null;
  memberCount: number;
  /** Total tokens (prompt + completion) consumed since `since`. */
  tokensThisPeriod: number;
}

export interface ListPlatformOrgsParams {
  page: number;
  limit: number;
  search?: string;
  sortBy: 'createdAt' | 'name' | 'tokens';
  sortOrder: 'asc' | 'desc';
  /** ISO timestamp; token usage is summed from this instant onward. */
  since: string;
}

/**
 * Cross-organization listing for the platform (super-admin) panel. Aggregates
 * each org's active plan, member count, and token consumption since `since` in
 * a single paginated query. Token totals join `ai_token_usage` filtered by
 * `since`, leaning on the existing `(org_id, created_at)` index.
 */
export async function listPlatformOrganizations(
  params: ListPlatformOrgsParams
): Promise<{ items: PlatformOrgListItem[]; total: number }> {
  const { page, limit, search, sortBy, sortOrder, since } = params;
  const offset = (page - 1) * limit;

  const searchFilter = search
    ? or(ilike(schema.organization.name, `%${search}%`), ilike(schema.organization.siteName, `%${search}%`))
    : undefined;

  // Active plan for the org (isActive = true), if any.
  const activePlan = db
    .select({
      orgId: schema.organizationPlan.orgId,
      planName: schema.organizationPlan.planName
    })
    .from(schema.organizationPlan)
    .where(eq(schema.organizationPlan.isActive, true))
    .as('active_plan');

  // Token consumption per org since `since`.
  const tokenUsage = db
    .select({
      orgId: schema.aiTokenUsage.orgId,
      tokens: sum(sql`${schema.aiTokenUsage.promptTokens} + ${schema.aiTokenUsage.completionTokens}`)
        .mapWith(Number)
        .as('tokens')
    })
    .from(schema.aiTokenUsage)
    .where(gte(schema.aiTokenUsage.createdAt, since))
    .groupBy(schema.aiTokenUsage.orgId)
    .as('token_usage');

  // Member count per org.
  const memberCounts = db
    .select({
      orgId: schema.organizationmember.organizationId,
      memberCount: count(schema.organizationmember.id).mapWith(Number).as('member_count')
    })
    .from(schema.organizationmember)
    .groupBy(schema.organizationmember.organizationId)
    .as('member_counts');

  const tokensExpr = sql<number>`coalesce(${tokenUsage.tokens}, 0)`;
  const membersExpr = sql<number>`coalesce(${memberCounts.memberCount}, 0)`;

  const orderColumn =
    sortBy === 'name'
      ? schema.organization.name
      : sortBy === 'tokens'
        ? tokensExpr
        : schema.organization.createdAt;
  const orderBy = sortOrder === 'asc' ? asc(orderColumn) : desc(orderColumn);

  const rows = await db
    .select({
      id: schema.organization.id,
      name: schema.organization.name,
      siteName: schema.organization.siteName,
      avatarUrl: schema.organization.avatarUrl,
      createdAt: schema.organization.createdAt,
      isRestricted: schema.organization.isRestricted,
      readOnlyUntil: schema.organization.readOnlyUntil,
      customDomain: schema.organization.customDomain,
      isCustomDomainVerified: schema.organization.isCustomDomainVerified,
      planName: activePlan.planName,
      memberCount: membersExpr,
      tokensThisPeriod: tokensExpr
    })
    .from(schema.organization)
    .leftJoin(activePlan, eq(activePlan.orgId, schema.organization.id))
    .leftJoin(tokenUsage, eq(tokenUsage.orgId, schema.organization.id))
    .leftJoin(memberCounts, eq(memberCounts.orgId, schema.organization.id))
    .where(searchFilter)
    .orderBy(orderBy)
    .limit(limit)
    .offset(offset);

  const [{ value: total }] = await db
    .select({ value: count() })
    .from(schema.organization)
    .where(searchFilter);

  return { items: rows, total };
}

export interface PlatformOrgDetail extends TOrganization {
  planName: string | null;
  memberCount: number;
  tokensAllTime: number;
  /** Token usage grouped by calendar month (YYYY-MM), most recent first. */
  monthlyUsage: Array<{ month: string; tokens: number }>;
}

export async function getPlatformOrganizationDetail(orgId: string): Promise<PlatformOrgDetail | null> {
  const [org] = await db.select().from(schema.organization).where(eq(schema.organization.id, orgId)).limit(1);

  if (!org) {
    return null;
  }

  const [activePlan] = await db
    .select({ planName: schema.organizationPlan.planName })
    .from(schema.organizationPlan)
    .where(and(eq(schema.organizationPlan.orgId, orgId), eq(schema.organizationPlan.isActive, true)))
    .limit(1);

  const [{ memberCount }] = await db
    .select({ memberCount: count(schema.organizationmember.id).mapWith(Number) })
    .from(schema.organizationmember)
    .where(eq(schema.organizationmember.organizationId, orgId));

  const monthlyRows = await db
    .select({
      month: sql<string>`to_char(${schema.aiTokenUsage.createdAt}, 'YYYY-MM')`.as('month'),
      tokens: sum(sql`${schema.aiTokenUsage.promptTokens} + ${schema.aiTokenUsage.completionTokens}`)
        .mapWith(Number)
        .as('tokens')
    })
    .from(schema.aiTokenUsage)
    .where(eq(schema.aiTokenUsage.orgId, orgId))
    .groupBy(sql`to_char(${schema.aiTokenUsage.createdAt}, 'YYYY-MM')`)
    .orderBy(desc(sql`to_char(${schema.aiTokenUsage.createdAt}, 'YYYY-MM')`));

  const tokensAllTime = monthlyRows.reduce((acc, row) => acc + (row.tokens ?? 0), 0);

  return {
    ...org,
    planName: activePlan?.planName ?? null,
    memberCount,
    tokensAllTime,
    monthlyUsage: monthlyRows
  };
}

/** Updates platform-editable org fields (name only for now). Returns the row or null. */
export async function updatePlatformOrganization(
  orgId: string,
  data: { name?: string }
): Promise<TOrganization | null> {
  try {
    const [updated] = await db
      .update(schema.organization)
      .set(data)
      .where(eq(schema.organization.id, orgId))
      .returning();

    return updated ?? null;
  } catch (error) {
    console.error('updatePlatformOrganization error:', error);
    throw new Error('Failed to update organization');
  }
}

/**
 * Suspends or reactivates an org. Suspending sets `isRestricted` and an optional
 * `readOnlyUntil`; reactivating clears both.
 */
export async function setPlatformOrganizationSuspension(
  orgId: string,
  suspend: boolean,
  readOnlyUntil?: string | null
): Promise<TOrganization | null> {
  try {
    const [updated] = await db
      .update(schema.organization)
      .set({
        isRestricted: suspend,
        readOnlyUntil: suspend ? (readOnlyUntil ?? null) : null
      })
      .where(eq(schema.organization.id, orgId))
      .returning();

    return updated ?? null;
  } catch (error) {
    console.error('setPlatformOrganizationSuspension error:', error);
    throw new Error('Failed to update organization suspension state');
  }
}

export type PlatformPlanName = 'BASIC' | 'EARLY_ADOPTER' | 'ENTERPRISE';

/**
 * Sets an organization's active plan (platform admin action). Deactivates any
 * currently-active plan row and inserts a fresh active one, preserving the plan
 * history. Manually-assigned plans use `provider = 'platform'` and a generated
 * subscription id so they don't collide with billing-provider subscriptions.
 */
export async function setPlatformOrganizationPlan(
  orgId: string,
  planName: PlatformPlanName
): Promise<{ orgId: string; planName: PlatformPlanName } | null> {
  try {
    return await db.transaction(async (tx) => {
      const [org] = await tx
        .select({ id: schema.organization.id })
        .from(schema.organization)
        .where(eq(schema.organization.id, orgId))
        .limit(1);

      if (!org) return null;

      // Retire the current active plan (if any).
      await tx
        .update(schema.organizationPlan)
        .set({ isActive: false, deactivatedAt: sql`timezone('utc'::text, now())` })
        .where(and(eq(schema.organizationPlan.orgId, orgId), eq(schema.organizationPlan.isActive, true)));

      await tx.insert(schema.organizationPlan).values({
        orgId,
        planName,
        isActive: true,
        provider: 'platform',
        subscriptionId: `platform-${orgId}-${crypto.randomUUID()}`,
        payload: { assignedBy: 'platform-admin' }
      });

      return { orgId, planName };
    });
  } catch (error) {
    console.error('setPlatformOrganizationPlan error:', error);
    throw new Error('Failed to update organization plan');
  }
}
