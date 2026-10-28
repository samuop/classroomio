import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TCourseInviteForRemoval } from '@cio/db/queries/organization';

const COURSE = '00000000-0000-4000-8000-000000000001';
const ORG = '00000000-0000-4000-8000-000000000002';
const FUTURE = '2999-01-01T00:00:00.000Z';

const getCourseWithOrgData = vi.fn(async (_id: string) => ({ id: COURSE, orgId: ORG }) as unknown);
const listByEmail = vi.fn(async (_org: string, _course: string, _email: string): Promise<TCourseInviteForRemoval[]> => []);
const remove = vi.fn(async (_ids: string[], _detach: unknown[]) => {});

vi.mock('@cio/db/queries/course', () => ({
  getCourseWithOrgData: (id: string) => getCourseWithOrgData(id)
}));

vi.mock('@cio/db/queries/course/people', () => ({
  getCourseMembers: vi.fn(async () => [])
}));

vi.mock('@cio/db/queries/organization', () => ({
  listOrganizationInviteEmailEvents: vi.fn(async () => []),
  listOrganizationInvitesForCourse: vi.fn(async () => []),
  listOrganizationInvitesForCourseByEmail: (org: string, course: string, email: string) => listByEmail(org, course, email),
  removeCourseFromOrganizationInvites: (ids: string[], detach: unknown[]) => remove(ids, detach)
}));

const { removeCourseInvitation } = await import('@api/services/course/invitations');

function stored(overrides: Partial<TCourseInviteForRemoval> = {}): TCourseInviteForRemoval {
  return {
    id: 'invite-1',
    acceptedAt: null,
    isRevoked: true,
    expiresAt: FUTURE,
    metadata: { courseIds: [COURSE] },
    ...overrides
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('removeCourseInvitation', () => {
  it('looks the invites up in the course organization, by the email it was given', async () => {
    listByEmail.mockResolvedValueOnce([stored()]);

    await removeCourseInvitation(COURSE, 'Prueba@Ejemplo.com');

    expect(listByEmail).toHaveBeenCalledWith(ORG, COURSE, 'Prueba@Ejemplo.com');
  });

  it('deletes the finished invites and reports how many', async () => {
    listByEmail.mockResolvedValueOnce([stored({ id: 'a' }), stored({ id: 'b', isRevoked: false, acceptedAt: FUTURE })]);

    await expect(removeCourseInvitation(COURSE, 'prueba@ejemplo.com')).resolves.toEqual({ deleted: 2, detached: 0 });
    expect(remove).toHaveBeenCalledWith(['a', 'b'], []);
  });

  it('answers 409 and writes nothing when the invitation is still live', async () => {
    listByEmail.mockResolvedValueOnce([stored({ isRevoked: false })]);

    await expect(removeCourseInvitation(COURSE, 'prueba@ejemplo.com')).rejects.toMatchObject({ statusCode: 409 });
    expect(remove).not.toHaveBeenCalled();
  });

  it('answers 404 when the person has no invitation to this course', async () => {
    await expect(removeCourseInvitation(COURSE, 'nadie@ejemplo.com')).rejects.toMatchObject({ statusCode: 404 });
    expect(remove).not.toHaveBeenCalled();
  });

  it('answers 404 for a course that does not exist, without looking up invites', async () => {
    getCourseWithOrgData.mockResolvedValueOnce(null);

    await expect(removeCourseInvitation(COURSE, 'prueba@ejemplo.com')).rejects.toMatchObject({ statusCode: 404 });
    expect(listByEmail).not.toHaveBeenCalled();
  });
});
