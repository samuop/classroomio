import { BaseApi, classroomio } from '$lib/utils/services/api';

import type { GetTrackingOverviewRequest, TrackingOverviewData } from '../utils/types';

/**
 * Client for the unified student-tracking hub. Mirrors the at-risk api store:
 * fetch once per org, cache by org id.
 */
class TrackingApi extends BaseApi {
  overview = $state<TrackingOverviewData | null>(null);
  loading = $state(false);
  lastFetchedOrgId = $state<string | null>(null);

  async fetchOverview(orgId: string) {
    if (!orgId) return;

    this.loading = true;
    this.lastFetchedOrgId = orgId;
    await this.execute<GetTrackingOverviewRequest>({
      requestFn: () => classroomio.organization.tracking.overview.$get(),
      logContext: 'fetching org tracking overview',
      onSuccess: (response) => {
        this.overview = response.data;
      }
    });
    this.loading = false;
  }

  ensureFetched(orgId: string) {
    if (this.lastFetchedOrgId === orgId) return;

    this.fetchOverview(orgId);
  }
}

export const trackingApi = new TrackingApi();
