import { BaseApiWithErrors, classroomio } from '$lib/utils/services/api';
import { mapZodErrorsToTranslations } from '$lib/utils/validation';
import { ZAiImageSettingsUpdate } from '@cio/utils/validation';
import { snackbar } from '$features/ui/snackbar/store';

import type {
  AiImagePreview,
  GetOrgAiImagesRequest,
  OrgAiImageSettings,
  PreviewAiImageRequest,
  UpdateOrgAiImagesRequest
} from '../utils/types';

class AiImageApi extends BaseApiWithErrors {
  settings = $state<OrgAiImageSettings | null>(null);
  preview = $state<AiImagePreview | null>(null);
  loading = $state(false);
  saving = $state(false);
  /** Separate from `saving`: generating costs money and takes ~10s, so it needs its own state. */
  previewing = $state(false);

  async fetchSettings() {
    this.loading = true;

    try {
      await this.execute<GetOrgAiImagesRequest>({
        requestFn: () => classroomio.organization['ai-images'].$get(),
        logContext: 'fetching org AI image settings',
        onSuccess: (response) => {
          this.settings = response.data;
        }
      });
    } finally {
      this.loading = false;
    }
  }

  async updateSettings(patch: Partial<OrgAiImageSettings>) {
    const result = ZAiImageSettingsUpdate.safeParse(patch);

    if (!result.success) {
      this.errors = mapZodErrorsToTranslations(result.error);
      return;
    }

    this.saving = true;

    try {
      await this.execute<UpdateOrgAiImagesRequest>({
        requestFn: () => classroomio.organization['ai-images'].$put({ json: result.data }),
        logContext: 'updating org AI image settings',
        onSuccess: (response) => {
          this.settings = response.data;
          this.errors = {};
          snackbar.success('ai_images.snackbar.saved');
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

  /** Generates one image from the CURRENT form values, saved or not. */
  async generatePreview(input: { styleNote?: string; styleReferenceUrl?: string | null }) {
    this.previewing = true;

    try {
      await this.execute<PreviewAiImageRequest>({
        requestFn: () => classroomio.organization['ai-images'].preview.$post({ json: input }),
        logContext: 'generating an AI image style preview',
        onSuccess: (response) => {
          this.preview = response.data;
        }
      });
    } finally {
      this.previewing = false;
    }
  }
}

export const aiImageApi = new AiImageApi();
