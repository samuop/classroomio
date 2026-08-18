import { BaseApi, classroomio } from '$lib/utils/services/api';

import type { ComplianceOverviewData, ComplianceOverviewRequest } from '../utils/types';
import type { TrackingScope } from '$features/tracking/utils/types';

class ComplianceApi extends BaseApi {
  overview = $state<ComplianceOverviewData | null>(null);
  loading = $state(false);
  lastFetchedKey = $state<string | null>(null);

  /** Defaults to `all`, like the other two tabs of the hub. */
  async fetchOverview(orgId: string, scope: TrackingScope = 'all') {
    if (!orgId) return;

    this.loading = true;
    this.lastFetchedKey = `${orgId}:${scope}`;
    await this.execute<ComplianceOverviewRequest>({
      requestFn: () => classroomio.dash['compliance-overview'].$get({ query: { orgId, scope } }),
      logContext: 'fetching org compliance overview',
      onSuccess: (response) => {
        this.overview = response.data;
      }
    });
    this.loading = false;
  }

  ensureFetched(orgId: string, scope: TrackingScope = 'all') {
    if (this.lastFetchedKey === `${orgId}:${scope}`) return;

    this.fetchOverview(orgId, scope);
  }
}

export const complianceApi = new ComplianceApi();
