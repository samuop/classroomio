/**
 * Per-organization look for generated lesson illustrations.
 *
 * Deliberately the same arrangement as `at-risk.ts`: stored under
 * `organization.settings`, merged onto a single source of truth for the
 * defaults, written through the deep-merging `updateOrganization` so the other
 * keys under `settings` survive.
 */
import { getOrganizationById, getOrgAiImageSettings, updateOrganization } from '@cio/db/queries';
import { DEFAULT_AI_IMAGE_SETTINGS, type TAiImageSettings } from '@cio/utils/validation';

import { AppError } from '@api/utils/errors';

/** Stored settings merged onto the defaults. Never throws — an org with none configured gets the house style. */
export async function getOrgAiImageSettingsService(orgId: string): Promise<TAiImageSettings> {
  const stored = await getOrgAiImageSettings(orgId);

  return { ...DEFAULT_AI_IMAGE_SETTINGS, ...(stored ?? {}) };
}

export async function updateOrgAiImageSettingsService(
  orgId: string,
  patch: Partial<TAiImageSettings>
): Promise<TAiImageSettings> {
  const org = await getOrganizationById(orgId);
  if (!org) {
    throw new AppError('Organization not found', 'ORGANIZATION_NOT_FOUND', 404);
  }

  const current = await getOrgAiImageSettingsService(orgId);
  const next: TAiImageSettings = { ...current, ...patch };

  await updateOrganization(orgId, { settings: { aiImages: next } });

  return next;
}
