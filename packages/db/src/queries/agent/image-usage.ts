import * as schema from '@db/schema';

import { and, count, eq, gte } from 'drizzle-orm';

import { db } from '@db/drizzle';

/** Para qué se pidió la imagen. Sirve para explicar un consumo, no para topearlo. */
export type ImageUsageKind = 'lesson' | 'cover' | 'preview';

/**
 * Deja constancia de una imagen generada.
 *
 * Se llama DESPUÉS de que la imagen existe: contar antes convertiría un fallo
 * del proveedor en cupo consumido, y la empresa pagaría dos veces por el mismo
 * intento.
 */
export async function recordImageUsage(input: {
  orgId: string;
  userId?: string | null;
  courseId?: string | null;
  kind: ImageUsageKind;
}): Promise<void> {
  await db.insert(schema.aiImageUsage).values({
    orgId: input.orgId,
    userId: input.userId ?? null,
    courseId: input.courseId ?? null,
    kind: input.kind
  });
}

/** Cuántas imágenes generó una empresa desde una fecha. */
export async function countImagesSince(orgId: string, desde: Date): Promise<number> {
  const [fila] = await db
    .select({ total: count() })
    .from(schema.aiImageUsage)
    .where(and(eq(schema.aiImageUsage.orgId, orgId), gte(schema.aiImageUsage.createdAt, desde.toISOString())));

  return Number(fila?.total ?? 0);
}
