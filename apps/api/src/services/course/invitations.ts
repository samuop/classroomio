import {
  listOrganizationInviteEmailEvents,
  listOrganizationInvitesForCourse,
  listOrganizationInvitesForCourseByEmail,
  removeCourseFromOrganizationInvites,
  type TCourseInviteForRemoval,
  type TCourseInviteRow,
  type TInviteEmailEvent
} from '@cio/db/queries/organization';

import { AppError, ErrorCodes } from '@api/utils/errors';
import { getCourseMembers } from '@cio/db/queries/course/people';
import { getCourseWithOrgData } from '@cio/db/queries/course';

export type CourseInvitationStatus = 'accepted' | 'pending' | 'expired' | 'revoked';

export interface CourseInvitation {
  id: string;
  email: string;
  status: CourseInvitationStatus;
  invitedAt: string;
  expiresAt: string;
  acceptedAt: string | null;
  emailSentAt: string | null;
  emailFailedAt: string | null;
  /** Whether the person is actually a member of this course's group today. */
  enrolled: boolean;
  name: string | null;
}

export interface CourseInvitationSummary {
  total: number;
  joined: number;
  pending: number;
  expired: number;
  revoked: number;
}

/**
 * Status of a single invite, from the invite row alone.
 *
 * Order matters: a revoked invite that also expired is reported as revoked
 * because that is the action someone took, and an accepted invite stays
 * accepted forever regardless of its expiry date.
 */
export function deriveCourseInvitationStatus(
  invite: Pick<TCourseInviteRow, 'acceptedAt' | 'isRevoked' | 'expiresAt'>,
  now: number = Date.now()
): CourseInvitationStatus {
  if (invite.acceptedAt) {
    return 'accepted';
  }

  if (invite.isRevoked) {
    return 'revoked';
  }

  if (new Date(invite.expiresAt).getTime() <= now) {
    return 'expired';
  }

  return 'pending';
}

/**
 * Collapses repeat invitations to one row per person.
 *
 * Re-inviting an email revokes the previous invite and inserts a new one, so a
 * teacher who clicked twice would otherwise see the same student listed twice —
 * once "revoked", once "pending" — which reads as a problem rather than as a
 * retry. The newest invite is the one that describes where the person stands.
 */
export function keepLatestInvitePerEmail(rows: TCourseInviteRow[]): TCourseInviteRow[] {
  const latestByEmail = new Map<string, TCourseInviteRow>();

  for (const row of rows) {
    const key = row.email.toLowerCase().trim();
    const existing = latestByEmail.get(key);

    if (!existing || new Date(row.createdAt).getTime() > new Date(existing.createdAt).getTime()) {
      latestByEmail.set(key, row);
    }
  }

  return [...latestByEmail.values()];
}

/** Newest email attempt per invite, split by outcome. */
export function indexEmailEvents(events: TInviteEmailEvent[]): Map<string, { sentAt: string | null; failedAt: string | null }> {
  const byInvite = new Map<string, { sentAt: string | null; failedAt: string | null }>();

  for (const event of events) {
    const current = byInvite.get(event.inviteId) ?? { sentAt: null, failedAt: null };
    const field = event.eventType === 'EMAIL_SENT' ? 'sentAt' : 'failedAt';

    if (!current[field] || new Date(event.createdAt).getTime() > new Date(current[field]!).getTime()) {
      current[field] = event.createdAt;
    }

    byInvite.set(event.inviteId, current);
  }

  return byInvite;
}

export function summarizeCourseInvitations(invitations: CourseInvitation[]): CourseInvitationSummary {
  return {
    total: invitations.length,
    joined: invitations.filter((invitation) => invitation.enrolled).length,
    pending: invitations.filter((invitation) => !invitation.enrolled && invitation.status === 'pending').length,
    expired: invitations.filter((invitation) => !invitation.enrolled && invitation.status === 'expired').length,
    revoked: invitations.filter((invitation) => !invitation.enrolled && invitation.status === 'revoked').length
  };
}

export interface InvitationRemovalPlan {
  /** A live link is never deleted: it has to be revoked first. */
  pending: boolean;
  deleteIds: string[];
  detach: Array<{ id: string; metadata: Record<string, unknown> }>;
}

/**
 * Takes this course off a person's invites. An invite that also lists other
 * courses stays for them; one that was only for this course is deleted.
 */
export function planInvitationRemoval(
  rows: TCourseInviteForRemoval[],
  courseId: string,
  now: number = Date.now()
): InvitationRemovalPlan {
  const plan: InvitationRemovalPlan = {
    pending: rows.some((row) => deriveCourseInvitationStatus(row, now) === 'pending'),
    deleteIds: [],
    detach: []
  };

  for (const row of rows) {
    const courseIds = Array.isArray(row.metadata.courseIds) ? (row.metadata.courseIds as unknown[]) : [];
    const otherCourses = courseIds.filter((id) => id !== courseId);

    if (otherCourses.length === 0) {
      plan.deleteIds.push(row.id);
    } else {
      plan.detach.push({ id: row.id, metadata: { ...row.metadata, courseIds: otherCourses } });
    }
  }

  return plan;
}

/** Removes a person's finished invitations (revoked, expired or accepted) from this course. */
export async function removeCourseInvitation(
  courseId: string,
  email: string
): Promise<{ deleted: number; detached: number }> {
  const course = await getCourseWithOrgData(courseId);

  if (!course) {
    throw new AppError('Course not found', ErrorCodes.COURSE_NOT_FOUND, 404);
  }

  const rows = await listOrganizationInvitesForCourseByEmail(course.orgId, courseId, email);

  if (rows.length === 0) {
    throw new AppError('Invitation not found', ErrorCodes.NOT_FOUND, 404);
  }

  const plan = planInvitationRemoval(rows, courseId);

  if (plan.pending) {
    throw new AppError('Revoke the pending invitation before removing it', ErrorCodes.CONFLICT, 409);
  }

  await removeCourseFromOrganizationInvites(plan.deleteIds, plan.detach);

  return { deleted: plan.deleteIds.length, detached: plan.detach.length };
}

/**
 * Who was invited to this course, and who actually got in.
 *
 * An invited student is invisible everywhere else until they accept: the import
 * flow can only create a group_member row for someone who already has a
 * profile, so brand-new invitees are absent from the course People table by
 * design. This is the only view that shows them.
 */
export async function listCourseInvitations(courseId: string): Promise<{
  invitations: CourseInvitation[];
  summary: CourseInvitationSummary;
}> {
  const course = await getCourseWithOrgData(courseId);

  if (!course) {
    throw new AppError('Course not found', ErrorCodes.COURSE_NOT_FOUND, 404);
  }

  const invites = keepLatestInvitePerEmail(await listOrganizationInvitesForCourse(course.orgId, courseId));

  if (invites.length === 0) {
    return { invitations: [], summary: summarizeCourseInvitations([]) };
  }

  const [emailEvents, members] = await Promise.all([
    listOrganizationInviteEmailEvents(invites.map((invite) => invite.id)),
    getCourseMembers(courseId)
  ]);

  const emailByInvite = indexEmailEvents(emailEvents);

  // Members can be matched by their profile email or by the address the invite
  // was addressed to, because a group_member row carries an email of its own.
  const memberByEmail = new Map<string, { name: string | null }>();
  for (const member of members) {
    for (const candidate of [member.profile?.email, member.email]) {
      if (candidate) {
        memberByEmail.set(candidate.toLowerCase().trim(), { name: member.profile?.fullname ?? null });
      }
    }
  }

  const invitations = invites
    .map((invite): CourseInvitation => {
      const normalizedEmail = invite.email.toLowerCase().trim();
      const member = memberByEmail.get(normalizedEmail);
      const delivery = emailByInvite.get(invite.id);

      return {
        id: invite.id,
        email: invite.email,
        status: deriveCourseInvitationStatus(invite),
        invitedAt: invite.createdAt,
        expiresAt: invite.expiresAt,
        acceptedAt: invite.acceptedAt,
        emailSentAt: delivery?.sentAt ?? null,
        emailFailedAt: delivery?.failedAt ?? null,
        enrolled: !!member,
        name: member?.name ?? null
      };
    })
    .sort((a, b) => new Date(b.invitedAt).getTime() - new Date(a.invitedAt).getTime());

  return {
    invitations,
    summary: summarizeCourseInvitations(invitations)
  };
}
