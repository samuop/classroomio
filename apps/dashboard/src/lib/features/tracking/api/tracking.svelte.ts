import { BaseApi, classroomio } from '$lib/utils/services/api';

import type { GetTrackingOverviewRequest, TrackingOverviewData, TrackingScope } from '../utils/types';

/**
 * Client for the unified student-tracking hub. Mirrors the at-risk api store:
 * fetch once per org, cache by org id — and by scope, because a consultancy
 * reads the same page two ways and they are different answers.
 */
class TrackingApi extends BaseApi {
  overview = $state<TrackingOverviewData | null>(null);
  loading = $state(false);
  lastFetchedKey = $state<string | null>(null);

  async fetchOverview(orgId: string, scope: TrackingScope = 'all') {
    if (!orgId) return;

    this.loading = true;
    this.lastFetchedKey = `${orgId}:${scope}`;
    await this.execute<GetTrackingOverviewRequest>({
      requestFn: () => classroomio.organization.tracking.overview.$get({ query: { scope } }),
      logContext: 'fetching org tracking overview',
      onSuccess: (response) => {
        this.overview = response.data;
      }
    });
    this.loading = false;
  }

  /**
   * Defaults to `all`.
   *
   * A company with no clients gets exactly what it always got — the scope
   * resolves to itself — while a consultancy lands on the answer it came for
   * instead of an empty page it has to know to widen.
   */
  ensureFetched(orgId: string, scope: TrackingScope = 'all') {
    if (this.lastFetchedKey === `${orgId}:${scope}`) return;

    this.fetchOverview(orgId, scope);
  }
}

export const trackingApi = new TrackingApi();
