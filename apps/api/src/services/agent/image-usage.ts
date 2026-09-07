import { countImagesSince, recordImageUsage, type ImageUsageKind } from '@cio/db/queries/agent';

import { AppError } from '@api/utils/errors';
import { env } from '@api/config/env';
import { getActiveOrganizationPlan } from '@cio/db/queries/organization';

/**
 * El tope de imágenes de una empresa.
 *
 * Existe por una razón concreta: generar una imagen cuesta plata y hasta acá no
 * se contaba en ningún lado. El tope de fichas no la cubre — una imagen no gasta
 * fichas, así que una empresa con el cupo de chat agotado podía seguir generando
 * imágenes sin límite.
 *
 * Vive donde ya vive `aiTokenAllowance`: dentro del `payload` del plan activo.
 * No es por comodidad — es para que una empresa tenga UN solo lugar que responda
 * "qué tiene permitido", y para que el panel de plataforma edite las dos cosas
 * en la misma pantalla y con el mismo gesto.
 */

const isSelfHosted = (): boolean => env.PUBLIC_IS_SELFHOSTED === 'true';

/** Lo que trae cada plan cuando la empresa no tiene un número propio. */
const PLAN_IMAGE_ALLOWANCES: Record<string, number> = {
  BASIC: 20,
  EARLY_ADOPTER: 100,
  ENTERPRISE: 300
};

function startOfCurrentMonth(): Date {
  const date = new Date();
  date.setDate(1);
  date.setHours(0, 0, 0, 0);

  return date;
}

/** El override de la empresa, ignorando cualquier cosa que no sea un número usable. */
export function readImageAllowance(payload: unknown): number | null {
  const value = (payload as { aiImageAllowance?: unknown } | null | undefined)?.aiImageAllowance;

  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

export interface ImageBalance {
  /** Generadas en el mes en curso. */
  used: number;
  /** El tope que rige: el propio de la empresa, o el de su plan. */
  allowance: number;
  remaining: number;
}

export async function getImageBalance(orgId: string): Promise<ImageBalance> {
  const [plan, used] = await Promise.all([
    getActiveOrganizationPlan(orgId),
    countImagesSince(orgId, startOfCurrentMonth())
  ]);

  const propio = readImageAllowance(plan?.payload);
  const allowance = propio ?? PLAN_IMAGE_ALLOWANCES[plan?.planName ?? ''] ?? PLAN_IMAGE_ALLOWANCES.BASIC;

  return { used, allowance, remaining: Math.max(0, allowance - used) };
}

/**
 * Corta antes de generar.
 *
 * Antes y no después por lo mismo que el tope de fichas: cobrarle a la empresa
 * la imagen que la dejó pasarse es cobrarle por el error de no haberla frenado.
 */
export async function enforceImageBalance(orgId: string): Promise<ImageBalance> {
  const balance = await getImageBalance(orgId);

  // Una instalación propia usa su propia clave del proveedor: el gasto es suyo
  // y no hay nada que racionar. Mismo criterio que el tope de fichas.
  if (isSelfHosted()) {
    return balance;
  }

  if (balance.remaining <= 0) {
    throw new AppError(
      `Se alcanzó el límite de ${balance.allowance} imágenes del mes para esta empresa.`,
      'IMAGE_LIMIT_REACHED',
      402
    );
  }

  return balance;
}

/** Deja constancia de una imagen ya generada. */
export async function noteImageGenerated(input: {
  orgId: string;
  userId?: string | null;
  courseId?: string | null;
  kind: ImageUsageKind;
}): Promise<void> {
  await recordImageUsage(input);
}
