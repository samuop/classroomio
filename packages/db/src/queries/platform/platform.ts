import * as schema from '@db/schema';

import { and, asc, count, desc, eq, gte, ilike, isNotNull, or, sql, sum } from 'drizzle-orm';

import { alias } from 'drizzle-orm/pg-core';
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
  /** Set when this workspace is a client company of a consultancy. */
  parentOrganizationId: string | null;
  /** The consultancy's name, so a client row still reads on its own. */
  parentName: string | null;
  /** How many client companies hang off this one. */
  clientCount: number;
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
 *
 * Rows come back as a flattened tree: every consultancy is immediately followed
 * by its client companies. The sort is applied to the FAMILY (a client sorts by
 * its parent's value, not its own) so that paging never tears a consultancy away
 * from its clients except at a page boundary — and `parentName` is carried on
 * every row so even that torn row still says whose client it is.
 */
export async function listPlatformOrganizations(
  params: ListPlatformOrgsParams
): Promise<{ items: PlatformOrgListItem[]; total: number }> {
  const { page, limit, search, sortBy, sortOrder, since } = params;
  const offset = (page - 1) * limit;

  const parentOrg = alias(schema.organization, 'parent_org');

  // Searching a consultancy's name deliberately returns its clients too: in a
  // tree, "Egea" meaning only the one row would hide exactly what you opened
  // the panel to see.
  const searchFilter = search
    ? or(
        ilike(schema.organization.name, `%${search}%`),
        ilike(schema.organization.siteName, `%${search}%`),
        ilike(parentOrg.name, `%${search}%`)
      )
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

  // Token consumption per org since `since`. Built twice under different names:
  // once joined on the row itself, once on its parent, because the family sort
  // below has to order a client by the consultancy's number. The COLUMN alias
  // differs per copy too — drizzle renders a subquery column unqualified, so two
  // subqueries both exposing `tokens` make every reference to it ambiguous and
  // Postgres rejects the whole statement.
  const tokenUsageSince = (name: string, columnAlias: string) =>
    db
      .select({
        orgId: schema.aiTokenUsage.orgId,
        tokens: sum(sql`${schema.aiTokenUsage.promptTokens} + ${schema.aiTokenUsage.completionTokens}`)
          .mapWith(Number)
          .as(columnAlias)
      })
      .from(schema.aiTokenUsage)
      .where(gte(schema.aiTokenUsage.createdAt, since))
      .groupBy(schema.aiTokenUsage.orgId)
      .as(name);

  const tokenUsage = tokenUsageSince('token_usage', 'tokens');
  const parentTokenUsage = tokenUsageSince('parent_token_usage', 'parent_tokens');

  // How many client companies each org has.
  const clientCounts = db
    .select({
      parentId: schema.organization.parentOrganizationId,
      clientCount: count().mapWith(Number).as('client_count')
    })
    .from(schema.organization)
    .where(isNotNull(schema.organization.parentOrganizationId))
    .groupBy(schema.organization.parentOrganizationId)
    .as('client_counts');

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

  const ownOrderColumn =
    sortBy === 'name' ? schema.organization.name : sortBy === 'tokens' ? tokensExpr : schema.organization.createdAt;

  // The value the whole family sorts on: its own for a consultancy, the
  // consultancy's for a client. Tokens can't use coalesce — a parent with no
  // usage yet is a legitimate 0, and coalescing to the child's own number would
  // scatter the family across the page.
  const familyOrderColumn =
    sortBy === 'name'
      ? sql`coalesce(${parentOrg.name}, ${schema.organization.name})`
      : sortBy === 'tokens'
        ? sql`case when ${parentOrg.id} is null then ${tokensExpr} else coalesce(${parentTokenUsage.tokens}, 0) end`
        : sql`coalesce(${parentOrg.createdAt}, ${schema.organization.createdAt})`;

  const direction = sortOrder === 'asc' ? asc : desc;

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
      tokensThisPeriod: tokensExpr,
      parentOrganizationId: schema.organization.parentOrganizationId,
      parentName: parentOrg.name,
      // mapWith, not just the type parameter: count() is a bigint and the driver
      // hands those back as strings, which would make the badge compare wrong.
      clientCount: sql<number>`coalesce(${clientCounts.clientCount}, 0)`.mapWith(Number)
    })
    .from(schema.organization)
    .leftJoin(parentOrg, eq(parentOrg.id, schema.organization.parentOrganizationId))
    .leftJoin(activePlan, eq(activePlan.orgId, schema.organization.id))
    .leftJoin(tokenUsage, eq(tokenUsage.orgId, schema.organization.id))
    .leftJoin(parentTokenUsage, eq(parentTokenUsage.orgId, schema.organization.parentOrganizationId))
    .leftJoin(clientCounts, eq(clientCounts.parentId, schema.organization.id))
    .leftJoin(memberCounts, eq(memberCounts.orgId, schema.organization.id))
    .where(searchFilter)
    // Family first, then the consultancy ahead of its own clients (its
    // parent id is NULL), then the clients among themselves.
    .orderBy(
      direction(familyOrderColumn),
      sql`${schema.organization.parentOrganizationId} asc nulls first`,
      direction(ownOrderColumn)
    )
    .limit(limit)
    .offset(offset);

  const [{ value: total }] = await db
    .select({ value: count() })
    .from(schema.organization)
    .leftJoin(parentOrg, eq(parentOrg.id, schema.organization.parentOrganizationId))
    .where(searchFilter);

  return { items: rows, total };
}

export interface PlatformOrgDetail extends TOrganization {
  planName: string | null;
  memberCount: number;
  tokensAllTime: number;
  /** Token usage grouped by calendar month (YYYY-MM), most recent first. */
  monthlyUsage: Array<{ month: string; tokens: number }>;
  /**
   * Per-organisation monthly token cap, or null to use the plan's default.
   *
   * Lives in the plan payload rather than a column because that is where
   * `getPlanAllowance` (apps/api, services/agent/usage.ts) already looks for it —
   * a second home would mean two answers to the same question.
   */
  aiTokenAllowance: number | null;
  /** Per-organisation chat model, or null to run on the deployment's. */
  aiModel: string | null;
}

/** The override as stored, ignoring anything that is not a usable number. */
function readAiTokenAllowance(payload: unknown): number | null {
  const value = (payload as { aiTokenAllowance?: unknown } | null | undefined)?.aiTokenAllowance;

  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

/** Same, for the per-organisation chat model. */
function readAiModel(payload: unknown): string | null {
  const value = (payload as { aiModel?: unknown } | null | undefined)?.aiModel;

  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

export async function getPlatformOrganizationDetail(orgId: string): Promise<PlatformOrgDetail | null> {
  const [org] = await db.select().from(schema.organization).where(eq(schema.organization.id, orgId)).limit(1);

  if (!org) {
    return null;
  }

  const [activePlan] = await db
    .select({ planName: schema.organizationPlan.planName, payload: schema.organizationPlan.payload })
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
    aiTokenAllowance: readAiTokenAllowance(activePlan?.payload),
    aiModel: readAiModel(activePlan?.payload),
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
/**
 * Sets the plan, and optionally the organisation's own monthly token cap.
 *
 * `aiTokenAllowance` follows three-state semantics, because "leave it alone" and
 * "clear it" are different operator intents:
 *   - `undefined` → keep whatever the current plan carried
 *   - `null`      → drop the override, fall back to the plan's default
 *   - a number    → that many tokens per month (0 disables AI for the org)
 *
 * Changing a plan supersedes the active row rather than editing it, so the
 * previous payload has to be carried across deliberately. It was not: every
 * plan change from the panel silently reset the payload to `{ assignedBy }`,
 * discarding a cap that had been set with the `set-allowance` script. A limit
 * that disappears when someone edits an unrelated field is worse than no limit,
 * because nobody goes back to check.
 */
export async function setPlatformOrganizationPlan(
  orgId: string,
  planName: PlatformPlanName,
  aiTokenAllowance?: number | null,
  aiModel?: string | null
): Promise<{
  orgId: string;
  planName: PlatformPlanName;
  aiTokenAllowance: number | null;
  aiModel: string | null;
} | null> {
  try {
    return await db.transaction(async (tx) => {
      const [org] = await tx
        .select({ id: schema.organization.id })
        .from(schema.organization)
        .where(eq(schema.organization.id, orgId))
        .limit(1);

      if (!org) return null;

      const [current] = await tx
        .select({ payload: schema.organizationPlan.payload })
        .from(schema.organizationPlan)
        .where(and(eq(schema.organizationPlan.orgId, orgId), eq(schema.organizationPlan.isActive, true)))
        .limit(1);

      const carried = (current?.payload as Record<string, unknown> | null) ?? {};
      const nextAllowance = aiTokenAllowance === undefined ? readAiTokenAllowance(current?.payload) : aiTokenAllowance;
      const nextModel = aiModel === undefined ? readAiModel(current?.payload) : aiModel;

      // Retire the current active plan (if any).
      await tx
        .update(schema.organizationPlan)
        .set({ isActive: false, deactivatedAt: sql`timezone('utc'::text, now())` })
        .where(and(eq(schema.organizationPlan.orgId, orgId), eq(schema.organizationPlan.isActive, true)));

      const { aiTokenAllowance: _dropped, aiModel: _droppedModel, ...rest } = carried;

      await tx.insert(schema.organizationPlan).values({
        orgId,
        planName,
        isActive: true,
        provider: 'platform',
        subscriptionId: `platform-${orgId}-${crypto.randomUUID()}`,
        payload: {
          ...rest,
          assignedBy: 'platform-admin',
          ...(nextAllowance === null ? {} : { aiTokenAllowance: nextAllowance }),
          ...(nextModel === null ? {} : { aiModel: nextModel })
        }
      });

      return { orgId, planName, aiTokenAllowance: nextAllowance, aiModel: nextModel };
    });
  } catch (error) {
    console.error('setPlatformOrganizationPlan error:', error);
    throw new Error('Failed to update organization plan');
  }
}

// ─── Deployment settings ─────────────────────────────────────────────────────

/** Every operator setting, as one object. Small table, read whole and cached. */
export async function getPlatformSettings(): Promise<Record<string, Record<string, unknown>>> {
  const rows = await db.select().from(schema.platformSetting);

  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}

/** Upsert by key. Returns the stored value so the caller can refresh its cache. */
export async function setPlatformSetting(
  key: string,
  value: Record<string, unknown>,
  updatedByProfileId?: string
): Promise<Record<string, unknown>> {
  const [row] = await db
    .insert(schema.platformSetting)
    .values({ key, value, updatedByProfileId })
    .onConflictDoUpdate({
      target: schema.platformSetting.key,
      set: { value, updatedByProfileId, updatedAt: sql`timezone('utc'::text, now())` }
    })
    .returning();

  return row.value;
}

/**
 * The chat model an organisation should run on, or null to use the global one.
 *
 * Stored beside `aiTokenAllowance` in the plan payload for the reason given on
 * `platformSetting`: what an organisation is allowed and how it runs belong in
 * the same row, so raising a cap and moving a client onto a cheaper model are
 * one read and one write, not two.
 */
export async function getOrganizationModelOverride(orgId: string): Promise<string | null> {
  const [plan] = await db
    .select({ payload: schema.organizationPlan.payload })
    .from(schema.organizationPlan)
    .where(and(eq(schema.organizationPlan.orgId, orgId), eq(schema.organizationPlan.isActive, true)))
    .limit(1);

  const value = (plan?.payload as { aiModel?: unknown } | null | undefined)?.aiModel;

  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}
