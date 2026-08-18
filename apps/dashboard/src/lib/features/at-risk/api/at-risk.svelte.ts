import { BaseApi, BaseApiWithErrors, classroomio } from '$lib/utils/services/api';
import { mapZodErrorsToTranslations } from '$lib/utils/validation';
import { ZAtRiskSettingsUpdate } from '@cio/utils/validation/at-risk';
import { snackbar } from '$features/ui/snackbar/store';

import type {
  AtRiskOverviewData,
  AtRiskSettings,
  GetAtRiskOverviewRequest,
  GetAtRiskSettingsRequest,
  UpdateAtRiskSettingsRequest
} from '../utils/types';
import type { TrackingScope } from '$features/tracking/utils/types';

class AtRiskApi extends BaseApi {
  overview = $state<AtRiskOverviewData | null>(null);
  loading = $state(false);
  lastFetchedKey = $state<string | null>(null);

  /** Defaults to `all` for the same reason the tracking hub does. */
  async fetchOverview(orgId: string, scope: TrackingScope = 'all') {
    if (!orgId) return;

    this.loading = true;
    this.lastFetchedKey = `${orgId}:${scope}`;
    await this.execute<GetAtRiskOverviewRequest>({
      requestFn: () => classroomio.organization['at-risk'].overview.$get({ query: { scope } }),
      logContext: 'fetching org at-risk overview',
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

class AtRiskSettingsApi extends BaseApiWithErrors {
  settings = $state<AtRiskSettings | null>(null);
  loading = $state(false);
  saving = $state(false);

  async fetchSettings() {
    this.loading = true;

    try {
      await this.execute<GetAtRiskSettingsRequest>({
        requestFn: () => classroomio.organization['at-risk'].$get(),
        logContext: 'fetching org at-risk settings',
        onSuccess: (response) => {
          this.settings = response.data;
        }
      });
    } finally {
      this.loading = false;
    }
  }

  async updateSettings(patch: Partial<AtRiskSettings>) {
    const result = ZAtRiskSettingsUpdate.safeParse(patch);

    if (!result.success) {
      this.errors = mapZodErrorsToTranslations(result.error);
      return;
    }

    this.saving = true;

    try {
      await this.execute<UpdateAtRiskSettingsRequest>({
        requestFn: () => classroomio.organization['at-risk'].$put({ json: result.data }),
        logContext: 'updating org at-risk settings',
        onSuccess: (response) => {
          this.settings = response.data;
          this.errors = {};
          snackbar.success('at_risk.settings.saved');
        },
        onError: (result) => {
          if (typeof result !== 'string' && 'field' in result && result.field) {
            this.errors[result.field] = result.error;
          }
        }
      });
    } finally {
      this.saving = false;
    }
  }
}

export const atRiskApi = new AtRiskApi();
export const atRiskSettingsApi = new AtRiskSettingsApi();
