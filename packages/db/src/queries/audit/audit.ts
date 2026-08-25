import * as schema from '@db/schema';

import { and, eq, gte, isNull, lt } from 'drizzle-orm';

import { db } from '@db/drizzle';

export type TAuditEventInsert = typeof schema.auditEvent.$inferInsert;
export type TAuditIncidentInsert = typeof schema.auditIncident.$inferInsert;

/**
 * Guarda una acción en el registro de auditoría.
 *
 * Devuelve `true` si la fila entró. Nunca tira: el que llama está en el camino
 * de un request que ya terminó, y perder un renglón del registro es
 * infinitamente preferible a romper lo que se estaba auditando.
 */
export async function insertAuditEvent(row: TAuditEventInsert): Promise<boolean> {
  try {
    await db.insert(schema.auditEvent).values(row);
    return true;
  } catch (error) {
    console.error('insertAuditEvent error:', error);
    return false;
  }
}

/**
 * ¿Ya hay un evento igual dentro de la ventana?
 *
 * Sostiene la regla anti-repetición de las lecturas: el dashboard vuelve a
 * pedir los mismos datos al recuperar el foco de la pestaña, y sin esto "abrió
 * el seguimiento de Andrea" aparecería seis veces en un rato.
 *
 * `entityId` null se compara con IS NULL a propósito: en SQL `null = null` es
 * desconocido, y con `eq` la ventana no filtraría nada justo en las acciones que
 * no tienen entidad (que son las que más se repiten).
 */
export async function hasRecentAuditEvent(params: {
  orgId: string | null;
  userId: string | null;
  action: string;
  entityId: string | null;
  since: string;
}): Promise<boolean> {
  try {
    const [found] = await db
      .select({ id: schema.auditEvent.id })
      .from(schema.auditEvent)
      .where(
        and(
          params.orgId ? eq(schema.auditEvent.orgId, params.orgId) : isNull(schema.auditEvent.orgId),
          params.userId ? eq(schema.auditEvent.userId, params.userId) : isNull(schema.auditEvent.userId),
          eq(schema.auditEvent.action, params.action),
          params.entityId ? eq(schema.auditEvent.entityId, params.entityId) : isNull(schema.auditEvent.entityId),
          gte(schema.auditEvent.createdAt, params.since)
        )
      )
      .limit(1);

    return !!found;
  } catch (error) {
    console.error('hasRecentAuditEvent error:', error);
    // Ante la duda, se registra: un renglón de más molesta menos que uno perdido.
    return false;
  }
}

/** Guarda una incidencia. Mismas reglas que `insertAuditEvent`. */
export async function insertAuditIncident(row: TAuditIncidentInsert): Promise<boolean> {
  try {
    await db.insert(schema.auditIncident).values(row);
    return true;
  } catch (error) {
    console.error('insertAuditIncident error:', error);
    return false;
  }
}

/**
 * Borra lo anterior al corte y devuelve cuántas filas se fueron de cada tabla.
 *
 * Cuenta antes de borrar en vez de usar RETURNING: un primer barrido puede
 * llevarse cientos de miles de filas y no hay motivo para traerlas todas a
 * memoria sólo para saber cuántas eran.
 */
export async function purgeAuditBefore(cutoff: string): Promise<{ events: number; incidents: number }> {
  const events = await deleteOlderThan(schema.auditEvent, cutoff);
  const incidents = await deleteOlderThan(schema.auditIncident, cutoff);

  return { events, incidents };
}

async function deleteOlderThan(
  table: typeof schema.auditEvent | typeof schema.auditIncident,
  cutoff: string
): Promise<number> {
  const total = await db.$count(table, lt(table.createdAt, cutoff));

  await db.delete(table).where(lt(table.createdAt, cutoff));

  return Number(total ?? 0);
}
