import { BaseApi, classroomio } from '$lib/utils/services/api';

import type { GetStudentOverviewRequest, StudentOverview } from '../utils/types';

class StudentApi extends BaseApi {
  overview = $state<StudentOverview | null>(null);
  loading = $state(false);
  lastFetchedProfileId = $state<string | null>(null);

  async fetchOverview(profileId: string) {
    if (!profileId) return;

    this.loading = true;
    this.overview = null;
    await this.execute<GetStudentOverviewRequest>({
      requestFn: () => classroomio.student[':profileId'].overview.$get({ param: { profileId } }),
      logContext: 'fetching student overview',
      onSuccess: (response) => {
        this.overview = response.data;
        // Only remember a profile once it loaded successfully, so a failed
        // attempt (e.g. org not ready yet) is retried by ensureFetched.
        this.lastFetchedProfileId = profileId;
      }
    });
    this.loading = false;
  }

  ensureFetched(profileId: string) {
    if (this.lastFetchedProfileId === profileId || this.loading) return;

    this.fetchOverview(profileId);
  }
}

export const studentApi = new StudentApi();
