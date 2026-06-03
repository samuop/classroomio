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

class AtRiskApi extends BaseApi {
  overview = $state<AtRiskOverviewData | null>(null);
  loading = $state(false);
  lastFetchedOrgId = $state<string | null>(null);

  async fetchOverview(orgId: string) {
    if (!orgId) return;

    this.loading = true;
    this.lastFetchedOrgId = orgId;
    await this.execute<GetAtRiskOverviewRequest>({
      requestFn: () => classroomio.organization['at-risk'].overview.$get({ query: {} }),
      logContext: 'fetching org at-risk overview',
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
