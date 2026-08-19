import { db } from '@db/drizzle';
import { sql } from 'drizzle-orm';

/**
 * A consultancy's view of one client company: enough to answer "how is this
 * client doing" without opening it.
 */
export interface ClientCompanyRollup {
  orgId: string;
  name: string;
  siteName: string | null;
  studentCount: number;
  courseCount: number;
  /** Mean of every enrolment's lesson completion, 0-100. */
  averageProgress: number;
  /** Enrolments finished to the point of earning a certificate. */
  certificatesEarned: number;
  /** Enrolments not finished and with no lesson completed yet. */
  notStarted: number;
  /**
   * Prompt + completion, matching the platform panel. `total_tokens` is the
   * provider's own figure and nullable on older rows; using it here would make
   * a client's consumption read differently depending on which panel you opened.
   */
  tokensThisPeriod: number;
}

interface ClientCompanyRow {
  org_id: string;
  name: string;
  site_name: string | null;
  student_count: number;
  course_count: number;
  average_progress: number | null;
  certificates_earned: number;
  not_started: number;
  tokens_this_period: number;
}

const STUDENT_ROLE_ID = 3;

/**
 * One row per client company of `parentOrgId`.
 *
 * Deliberately a single aggregate rather than the per-organization tracking
 * overview run in a loop: that one issues several queries per organization, and
 * this list grows with the consultancy's client list.
 *
 * Progress is the same arithmetic the tracking hub uses per learner — completed
 * lessons over the course's lessons — averaged over enrolments. Computing it any
 * other way would make a client's number here disagree with the number shown
 * inside that client, and the two would be impossible to reconcile by eye.
 */
export async function getClientCompanyRollups(parentOrgId: string, since: string): Promise<ClientCompanyRollup[]> {
  const result = await db.execute(sql`
    WITH client_org AS (
      -- The siteName column really is camel-cased in this table, unlike its
      -- snake_case neighbours, so it has to be quoted.
      SELECT id, name, "siteName" AS site_name
        FROM organization
       WHERE parent_organization_id = ${parentOrgId}
         AND deleted_at IS NULL
    ),
    enrolment AS (
      SELECT
        g.organization_id AS org_id,
        gm.profile_id,
        c.id AS course_id,
        gm.certificate_earned_at,
        (SELECT COUNT(*) FROM lesson l WHERE l.course_id = c.id)::int AS lessons_total,
        (SELECT COUNT(*) FROM lesson_completion lc
           JOIN lesson l ON l.id = lc.lesson_id
          WHERE l.course_id = c.id
            AND lc.profile_id = gm.profile_id
            AND lc.is_complete = true)::int AS lessons_completed
      FROM groupmember gm
      JOIN "group" g ON g.id = gm.group_id
      JOIN course c   ON c.group_id = gm.group_id
      JOIN client_org co ON co.id = g.organization_id
      WHERE gm.role_id = ${STUDENT_ROLE_ID}
        AND gm.profile_id IS NOT NULL
    ),
    per_org AS (
      SELECT
        org_id,
        COUNT(DISTINCT profile_id)::int AS student_count,
        COUNT(DISTINCT course_id)::int  AS course_count,
        AVG(
          CASE WHEN lessons_total > 0
               THEN (lessons_completed::numeric / lessons_total) * 100
               ELSE 0 END
        ) AS average_progress,
        COUNT(*) FILTER (WHERE certificate_earned_at IS NOT NULL)::int AS certificates_earned,
        COUNT(*) FILTER (WHERE certificate_earned_at IS NULL AND lessons_completed = 0)::int AS not_started
      FROM enrolment
      GROUP BY org_id
    ),
    per_org_tokens AS (
      SELECT org_id, SUM(prompt_tokens + completion_tokens)::int AS tokens
        FROM ai_token_usage
       WHERE created_at >= ${since}
       GROUP BY org_id
    )
    SELECT
      co.id        AS org_id,
      co.name      AS name,
      co.site_name AS site_name,
      COALESCE(po.student_count, 0)       AS student_count,
      COALESCE(po.course_count, 0)        AS course_count,
      po.average_progress                 AS average_progress,
      COALESCE(po.certificates_earned, 0) AS certificates_earned,
      COALESCE(po.not_started, 0)         AS not_started,
      COALESCE(pt.tokens, 0)              AS tokens_this_period
    FROM client_org co
    LEFT JOIN per_org po        ON po.org_id = co.id
    LEFT JOIN per_org_tokens pt ON pt.org_id = co.id
    ORDER BY co.name ASC
  `);

  const rows = result as unknown as ClientCompanyRow[];

  return rows.map((row) => ({
    orgId: row.org_id,
    name: row.name,
    siteName: row.site_name,
    studentCount: Number(row.student_count) || 0,
    courseCount: Number(row.course_count) || 0,
    averageProgress: Math.round(Number(row.average_progress) || 0),
    certificatesEarned: Number(row.certificates_earned) || 0,
    notStarted: Number(row.not_started) || 0,
    tokensThisPeriod: Number(row.tokens_this_period) || 0
  }));
}

/**
 * Tokens spent by the consultancy itself, apart from its clients'.
 *
 * Kept separate from the rollups so the page can show what the account as a
 * whole costs — the number a consultancy is billed on — without hiding which
 * part of it each client caused.
 */
export async function getOwnTokensThisPeriod(orgId: string, since: string): Promise<number> {
  const result = await db.execute(sql`
    SELECT COALESCE(SUM(prompt_tokens + completion_tokens), 0)::int AS tokens
      FROM ai_token_usage
     WHERE org_id = ${orgId}
       AND created_at >= ${since}
  `);

  const rows = result as unknown as Array<{ tokens: number }>;

  return Number(rows[0]?.tokens) || 0;
}
