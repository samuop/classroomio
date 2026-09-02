import {
  STUDENT_TUTOR_APPROACHING_THRESHOLD,
  STUDENT_TUTOR_MONTHLY_CAP,
  type AiTutorSettings
} from '@cio/ai-assistant/tutor-config';
import {
  getCapStatusSummary,
  getLearnerCapEvents,
  getLearnerCourseBreakdown,
  getLearnerDailyUsage,
  getLearnerLeaderboard,
  getMonthlyTutorCount,
  incrementMonthlyTutorCount,
  recordCapEvent
} from '@cio/db/queries/agent';

import { AppError } from '@api/utils/errors';
import { getEffectiveAiTutorSettings } from './tutor-config';
import { enforceTokenBalance } from './usage';

export const STUDENT_TUTOR_CAP = STUDENT_TUTOR_MONTHLY_CAP;

/**
 * Whether per-learner cap enforcement is on for this environment.
 * Phase 1 ships with this off (instrumentation only); Phase 3 flips it on.
 */
export function isCapEnforced(): boolean {
  const raw = process.env.AI_TUTOR_CAP_ENFORCED;
  if (raw == null) return false;
  return raw === '1' || raw.toLowerCase() === 'true';
}

function startOfCurrentMonthUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
}

function startOfPreviousMonthUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1, 0, 0, 0, 0));
}

function startOfLast90DaysUtc(): Date {
  const now = new Date();
  return new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
}

export function resolveTutorPeriod(period: 'current' | 'previous' | 'last90'): { start: Date; end?: Date } {
  if (period === 'previous') {
    const start = startOfPreviousMonthUtc();
    const end = startOfCurrentMonthUtc();
    return { start, end };
  }

  if (period === 'last90') {
    return { start: startOfLast90DaysUtc() };
  }

  return { start: startOfCurrentMonthUtc() };
}

export interface TutorPolicyResult {
  settings: AiTutorSettings;
  messageCount: number;
  /** `null` mientras no exista un tope por alumno. NO es cero. */
  capRemaining: number | null;
}

/**
 * Los dos unicos cortes, en este orden:
 *   1. El tutor esta apagado en la empresa  (`settings.enabled`)
 *   2. Se acabo el cupo de la empresa       (`enforceTokenBalance`)
 *
 * **No hay un tercer corte por alumno.** El PRD original (`prd/ai-tutor-fair-use`)
 * pedia un tope propio de 100 mensajes; se saco a proposito. Un tope fijo se
 * sobrevende apenas la empresa crece —10 alumnos ya suman el cupo entero— y ni
 * siquiera es donde se va la plata: un mensaje de alumno cuesta unas 25 veces
 * menos que un paso del creador de cursos.
 *
 * Cada corte deja su registro para que el admin sepa por que se freno alguien.
 */
export async function enforceStudentTutorPolicy(
  orgId: string,
  courseId: string,
  userId: string
): Promise<TutorPolicyResult> {
  const settings = await getEffectiveAiTutorSettings(orgId, courseId);

  if (!settings.enabled) {
    await recordCapEvent({ orgId, userId, courseId, eventType: 'tutor_disabled' });
    throw new AppError('AI tutor is disabled for this workspace', 'AI_TUTOR_DISABLED', 403);
  }

  try {
    await enforceTokenBalance(orgId);
  } catch (error) {
    if (error instanceof AppError && error.code === 'TOKEN_LIMIT_REACHED') {
      await recordCapEvent({ orgId, userId, courseId, eventType: 'pool_exhausted' });
      throw new AppError('AI tutor is taking a break', 'POOL_EXHAUSTED', 429);
    }
    throw error;
  }

  const monthly = await getMonthlyTutorCount(orgId, userId, startOfCurrentMonthUtc());

  // Los mensajes se siguen CONTANDO (el ranking de la pantalla de consumo vive
  // de eso), pero ya no hay tope propio del alumno: lo que gasta sale del cupo
  // que tiene asignado su empresa, y el unico corte es que ese cupo se acabe
  // —lo de arriba—. El tope por alumno se define mas adelante, con consumo real
  // a la vista, y por eso `capRemaining` va en null y no en cero.
  return {
    settings,
    messageCount: monthly.messageCount,
    capRemaining: null
  };
}

export async function incrementStudentTutorCount(
  orgId: string,
  userId: string,
  courseId: string
): Promise<{ messageCount: number; capHit: boolean }> {
  const result = await incrementMonthlyTutorCount({
    orgId,
    userId,
    periodStart: startOfCurrentMonthUtc(),
    cap: STUDENT_TUTOR_CAP
  });

  if (result.capHit && isCapEnforced()) {
    await recordCapEvent({ orgId, userId, courseId, eventType: 'cap_reached' });
  }

  return result;
}

export async function getStudentTutorStatus(
  orgId: string,
  courseId: string,
  userId: string
): Promise<{ enabled: boolean; cap: number | null; capRemaining: number | null; enforced: boolean }> {
  const settings = await getEffectiveAiTutorSettings(orgId, courseId);

  // Sin tope por alumno no hay medidor personal que mostrar: el consumo sale
  // del cupo de la empresa, que no es un dato del alumno. `null` apaga la barra
  // en la cabecera del chat; un cero la dibujaria vacia, que es otra cosa.
  return {
    enabled: settings.enabled,
    cap: null,
    capRemaining: null,
    enforced: isCapEnforced()
  };
}

// ─── Admin reads (Fair-Use leaderboard + summary + per-learner detail) ───────

export interface AdminLeaderboardEntry {
  userId: string;
  fullname: string | null;
  email: string | null;
  avatarUrl: string | null;
  messageCount: number;
  tokens: number;
  capRemaining: number;
  capPct: number;
  status: 'under' | 'approaching' | 'at_cap';
  capHitAt: string | null;
  lastMessageAt: string | null;
}

export async function getTutorLearnerLeaderboard(
  orgId: string,
  params: {
    period: 'current' | 'previous' | 'last90';
    search?: string;
    sort?: 'messages' | 'tokens' | 'capPct';
    page?: number;
    limit?: number;
  }
): Promise<{ entries: AdminLeaderboardEntry[]; total: number; cap: number; periodStart: string }> {
  const { start, end } = resolveTutorPeriod(params.period);
  const page = params.page ?? 1;
  const limit = params.limit ?? 20;

  const { rows, total } = await getLearnerLeaderboard(orgId, {
    periodStart: start,
    periodEnd: end,
    search: params.search,
    sort: params.sort,
    limit,
    offset: (page - 1) * limit
  });

  const entries: AdminLeaderboardEntry[] = rows.map((row) => {
    const messageCount = row.messageCount;
    const capPct = messageCount / STUDENT_TUTOR_CAP;
    const status: AdminLeaderboardEntry['status'] =
      messageCount >= STUDENT_TUTOR_CAP
        ? 'at_cap'
        : capPct >= STUDENT_TUTOR_APPROACHING_THRESHOLD
          ? 'approaching'
          : 'under';

    return {
      userId: row.userId,
      fullname: row.fullname,
      email: row.email,
      avatarUrl: row.avatarUrl,
      messageCount,
      tokens: row.tokens,
      capRemaining: Math.max(0, STUDENT_TUTOR_CAP - messageCount),
      capPct,
      status,
      capHitAt: row.capHitAt,
      lastMessageAt: row.lastMessageAt
    };
  });

  return { entries, total, cap: STUDENT_TUTOR_CAP, periodStart: start.toISOString() };
}

export async function getTutorCapStatusSummary(
  orgId: string,
  period: 'current' | 'previous' | 'last90' = 'current'
): Promise<{ atCap: number; approaching: number; totalActive: number; cap: number; periodStart: string }> {
  const { start } = resolveTutorPeriod(period);
  const summary = await getCapStatusSummary(orgId, start, STUDENT_TUTOR_CAP, STUDENT_TUTOR_APPROACHING_THRESHOLD);

  return { ...summary, cap: STUDENT_TUTOR_CAP, periodStart: start.toISOString() };
}

export interface AdminLearnerDetail {
  userId: string;
  cap: number;
  messageCount: number;
  capRemaining: number;
  status: AdminLeaderboardEntry['status'];
  dailyUsage: { date: string; messages: number; tokens: number }[];
  courseBreakdown: { courseId: string; courseTitle: string | null; tokens: number; messages: number }[];
  capEvents: { id: number; eventType: string; occurredAt: string; courseId: string | null }[];
  periodStart: string;
}

export async function getTutorLearnerDetail(
  orgId: string,
  userId: string,
  period: 'current' | 'previous' | 'last90' = 'current'
): Promise<AdminLearnerDetail> {
  const { start } = resolveTutorPeriod(period);
  const monthly = await getMonthlyTutorCount(orgId, userId, start);
  const [dailyUsage, courseBreakdown, capEvents] = await Promise.all([
    getLearnerDailyUsage(orgId, userId, start),
    getLearnerCourseBreakdown(orgId, userId, start),
    getLearnerCapEvents(orgId, userId, start)
  ]);

  const capPct = monthly.messageCount / STUDENT_TUTOR_CAP;
  const status: AdminLeaderboardEntry['status'] =
    monthly.messageCount >= STUDENT_TUTOR_CAP
      ? 'at_cap'
      : capPct >= STUDENT_TUTOR_APPROACHING_THRESHOLD
        ? 'approaching'
        : 'under';

  return {
    userId,
    cap: STUDENT_TUTOR_CAP,
    messageCount: monthly.messageCount,
    capRemaining: Math.max(0, STUDENT_TUTOR_CAP - monthly.messageCount),
    status,
    dailyUsage,
    courseBreakdown,
    capEvents,
    periodStart: start.toISOString()
  };
}
