import {
  type TNotificationId,
  type TNotificationSettingsUpdate,
  type TResolvedNotificationSettings,
  resolveNotificationSettings
} from '@cio/utils/validation/notifications';
import { getOrgNotificationSettings, getOrganizationById, updateOrganization } from '@cio/db/queries/organization';

import { AppError } from '@api/utils/errors';

/** Lo guardado con los defaults del catálogo debajo. Sin huecos. */
export async function getOrgNotificationSettingsService(orgId: string): Promise<TResolvedNotificationSettings> {
  const stored = await getOrgNotificationSettings(orgId);

  return resolveNotificationSettings(stored);
}

/**
 * Mezcla el parche sobre lo guardado. Reusa el `updateOrganization` que hace
 * merge profundo, así `settings.atRisk` y el resto quedan intactos: sólo se
 * toca `settings.notifications`.
 */
export async function updateOrgNotificationSettingsService(
  orgId: string,
  patch: TNotificationSettingsUpdate
): Promise<TResolvedNotificationSettings> {
  const org = await getOrganizationById(orgId);
  if (!org) {
    throw new AppError('Organization not found', 'ORGANIZATION_NOT_FOUND', 404);
  }

  const current = await getOrgNotificationSettingsService(orgId);
  const next: TResolvedNotificationSettings = { ...current, ...patch };

  await updateOrganization(orgId, { settings: { notifications: next } });

  return next;
}

/**
 * La compuerta que consultan los puntos de envío antes de encolar.
 *
 * **Falla hacia el envío, no hacia el silencio.** Si no se sabe de qué empresa
 * es el correo, o si la consulta se cae, se manda igual. El costo de los dos
 * errores no es simétrico: un aviso de más molesta, uno de menos puede ser un
 * tutor que nunca se entera de que hay una entrega esperando corrección. Nadie
 * revisa una bandeja para descubrir lo que NO llegó.
 */
export async function isNotificationEnabled(
  orgId: string | null | undefined,
  id: TNotificationId
): Promise<boolean> {
  if (!orgId) return true;

  try {
    const settings = await getOrgNotificationSettingsService(orgId);

    return settings[id];
  } catch (error) {
    console.error(`isNotificationEnabled(${id}) falló; se manda el correo igual:`, error);

    return true;
  }
}
