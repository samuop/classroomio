import { describe, expect, it } from 'vitest';

import {
  deriveCourseInvitationStatus,
  indexEmailEvents,
  keepLatestInvitePerEmail,
  summarizeCourseInvitations,
  type CourseInvitation
} from '@api/services/course/invitations';

const NOW = new Date('2026-08-13T00:00:00.000Z').getTime();
const FUTURE = '2026-08-20T00:00:00.000Z';
const PAST = '2026-08-01T00:00:00.000Z';

function invite(overrides: Partial<Parameters<typeof deriveCourseInvitationStatus>[0]> = {}) {
  return {
    acceptedAt: null,
    isRevoked: false,
    expiresAt: FUTURE,
    ...overrides
  };
}

function row(overrides: Partial<{ id: string; email: string; createdAt: string }> = {}) {
  return {
    id: 'invite-1',
    email: 'ana@example.com',
    acceptedAt: null,
    acceptedByProfileId: null,
    isRevoked: false,
    expiresAt: FUTURE,
    createdAt: '2026-08-10T00:00:00.000Z',
    ...overrides
  };
}

function invitation(overrides: Partial<CourseInvitation> = {}): CourseInvitation {
  return {
    id: 'invite-1',
    email: 'ana@example.com',
    status: 'pending',
    invitedAt: '2026-08-10T00:00:00.000Z',
    expiresAt: FUTURE,
    acceptedAt: null,
    emailSentAt: null,
    emailFailedAt: null,
    enrolled: false,
    name: null,
    ...overrides
  };
}

describe('deriveCourseInvitationStatus', () => {
  it('reports a live invite as pending', () => {
    expect(deriveCourseInvitationStatus(invite(), NOW)).toBe('pending');
  });

  it('reports an invite past its expiry as expired', () => {
    expect(deriveCourseInvitationStatus(invite({ expiresAt: PAST }), NOW)).toBe('expired');
  });

  it('reports a revoked invite as revoked', () => {
    expect(deriveCourseInvitationStatus(invite({ isRevoked: true }), NOW)).toBe('revoked');
  });

  it('prefers revoked over expired, because revoking is something someone did', () => {
    expect(deriveCourseInvitationStatus(invite({ isRevoked: true, expiresAt: PAST }), NOW)).toBe('revoked');
  });

  it('keeps an accepted invite accepted after it expires', () => {
    expect(deriveCourseInvitationStatus(invite({ acceptedAt: PAST, expiresAt: PAST }), NOW)).toBe('accepted');
  });
});

describe('keepLatestInvitePerEmail', () => {
  it('collapses a re-invite to the newest row, so one person is one line', () => {
    const result = keepLatestInvitePerEmail([
      row({ id: 'old', createdAt: '2026-08-01T00:00:00.000Z', isRevoked: true }),
      row({ id: 'new', createdAt: '2026-08-10T00:00:00.000Z' })
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('new');
  });

  it('treats addresses that differ only in case as the same person', () => {
    const result = keepLatestInvitePerEmail([
      row({ id: 'old', email: 'Ana@Example.com', createdAt: '2026-08-01T00:00:00.000Z' }),
      row({ id: 'new', email: 'ana@example.com', createdAt: '2026-08-10T00:00:00.000Z' })
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('new');
  });

  it('keeps distinct people apart', () => {
    const result = keepLatestInvitePerEmail([
      row({ id: 'a', email: 'ana@example.com' }),
      row({ id: 'b', email: 'bruno@example.com' })
    ]);

    expect(result).toHaveLength(2);
  });
});

describe('indexEmailEvents', () => {
  it('keeps the most recent attempt of each outcome per invite', () => {
    const index = indexEmailEvents([
      { inviteId: 'a', eventType: 'EMAIL_SENT', createdAt: '2026-08-02T00:00:00.000Z' },
      { inviteId: 'a', eventType: 'EMAIL_SENT', createdAt: '2026-08-05T00:00:00.000Z' },
      { inviteId: 'a', eventType: 'EMAIL_FAILED', createdAt: '2026-08-01T00:00:00.000Z' }
    ]);

    expect(index.get('a')).toEqual({
      sentAt: '2026-08-05T00:00:00.000Z',
      failedAt: '2026-08-01T00:00:00.000Z'
    });
  });

  it('leaves an invite with no email events out of the index', () => {
    expect(indexEmailEvents([]).get('a')).toBeUndefined();
  });
});

describe('summarizeCourseInvitations', () => {
  it('counts anyone enrolled as joined, whatever their invite says', () => {
    const summary = summarizeCourseInvitations([
      invitation({ id: '1', enrolled: true, status: 'accepted' }),
      // Given direct access while an old invite of theirs is still pending.
      invitation({ id: '2', enrolled: true, status: 'pending' }),
      invitation({ id: '3', status: 'pending' }),
      invitation({ id: '4', status: 'expired' }),
      invitation({ id: '5', status: 'revoked' })
    ]);

    expect(summary).toEqual({ total: 5, joined: 2, pending: 1, expired: 1, revoked: 1 });
  });

  it('reports zeroes for a course nobody was invited to', () => {
    expect(summarizeCourseInvitations([])).toEqual({ total: 0, joined: 0, pending: 0, expired: 0, revoked: 0 });
  });
});
