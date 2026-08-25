import * as schema from '@db/schema';

import { and, eq, inArray } from 'drizzle-orm';

import { db } from '@db/drizzle';

export interface OrgEmailTemplateRow {
  emailId: string;
  subject: string | null;
  body: string | null;
  updatedAt: Date;
}

/** Todos los textos que esta empresa reescribió. */
export const getOrgEmailTemplates = async (orgId: string): Promise<OrgEmailTemplateRow[]> => {
  return db
    .select({
      emailId: schema.organizationEmailTemplate.emailId,
      subject: schema.organizationEmailTemplate.subject,
      body: schema.organizationEmailTemplate.body,
      updatedAt: schema.organizationEmailTemplate.updatedAt
    })
    .from(schema.organizationEmailTemplate)
    .where(eq(schema.organizationEmailTemplate.organizationId, orgId));
};

/** Un texto puntual. Es el que se consulta en el camino de cada envío. */
export const getOrgEmailTemplate = async (
  orgId: string,
  emailId: string
): Promise<OrgEmailTemplateRow | null> => {
  const [row] = await db
    .select({
      emailId: schema.organizationEmailTemplate.emailId,
      subject: schema.organizationEmailTemplate.subject,
      body: schema.organizationEmailTemplate.body,
      updatedAt: schema.organizationEmailTemplate.updatedAt
    })
    .from(schema.organizationEmailTemplate)
    .where(
      and(
        eq(schema.organizationEmailTemplate.organizationId, orgId),
        eq(schema.organizationEmailTemplate.emailId, emailId)
      )
    )
    .limit(1);

  return row ?? null;
};

/**
 * Guarda el texto reescrito. `upsert` sobre (empresa, correo) para que dos
 * guardados seguidos no dejen dos filas — el índice único lo garantiza, esto
 * evita el error.
 */
export const upsertOrgEmailTemplate = async (input: {
  orgId: string;
  emailId: string;
  subject: string | null;
  body: string | null;
  updatedByProfileId?: string | null;
}): Promise<void> => {
  await db
    .insert(schema.organizationEmailTemplate)
    .values({
      organizationId: input.orgId,
      emailId: input.emailId,
      subject: input.subject,
      body: input.body,
      updatedByProfileId: input.updatedByProfileId ?? null
    })
    .onConflictDoUpdate({
      target: [schema.organizationEmailTemplate.organizationId, schema.organizationEmailTemplate.emailId],
      set: {
        subject: input.subject,
        body: input.body,
        updatedByProfileId: input.updatedByProfileId ?? null,
        updatedAt: new Date()
      }
    });
};

/**
 * Restaurar el original = borrar la fila.
 *
 * No se guarda una copia del texto de fábrica: si mañana ese texto mejora, la
 * empresa que "restauró" recibe la mejora en vez de quedar con una foto vieja.
 */
export const deleteOrgEmailTemplate = async (orgId: string, emailId: string): Promise<void> => {
  await db
    .delete(schema.organizationEmailTemplate)
    .where(
      and(
        eq(schema.organizationEmailTemplate.organizationId, orgId),
        eq(schema.organizationEmailTemplate.emailId, emailId)
      )
    );
};

/** Limpieza para cuando una empresa se borra de verdad. */
export const deleteOrgEmailTemplates = async (orgIds: string[]): Promise<void> => {
  if (orgIds.length === 0) return;

  await db
    .delete(schema.organizationEmailTemplate)
    .where(inArray(schema.organizationEmailTemplate.organizationId, orgIds));
};
