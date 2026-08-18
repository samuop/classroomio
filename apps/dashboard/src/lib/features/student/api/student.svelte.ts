import { BaseApi, classroomio } from '$lib/utils/services/api';

import type { GetStudentOverviewRequest, StudentOverview } from '../utils/types';

class StudentApi extends BaseApi {
  overview = $state<StudentOverview | null>(null);
  loading = $state(false);
  lastFetchedKey = $state<string | null>(null);

  /**
   * `orgId` overrides the active organisation for this one request.
   *
   * A consultancy admin opening a learner from the cross-company tracking view
   * is asking about a record that lives in a CLIENT company, while their own
   * context stays on the consultancy. The permission is not a new one: being
   * admin of the consultancy already derives admin of its clients, so the
   * existing membership check passes on its own.
   */
  async fetchOverview(profileId: string, orgId?: string) {
    if (!profileId) return;

    this.loading = true;
    this.overview = null;
    await this.execute<GetStudentOverviewRequest>({
      requestFn: () =>
        classroomio.student[':profileId'].overview.$get(
          { param: { profileId } },
          orgId ? { headers: { 'cio-org-id': orgId } } : undefined
        ),
      logContext: 'fetching student overview',
      onSuccess: (response) => {
        this.overview = response.data;
        // Only remember a profile once it loaded successfully, so a failed
        // attempt (e.g. org not ready yet) is retried by ensureFetched.
        this.lastFetchedKey = `${orgId ?? ''}:${profileId}`;
      }
    });
    this.loading = false;
  }

  ensureFetched(profileId: string, orgId?: string) {
    if (this.lastFetchedKey === `${orgId ?? ''}:${profileId}` || this.loading) return;

    this.fetchOverview(profileId, orgId);
  }
}

export const studentApi = new StudentApi();
