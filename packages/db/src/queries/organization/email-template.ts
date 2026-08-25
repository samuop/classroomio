import * as schema from '@db/schema';

import { and, eq, inArray } from 'drizzle-orm';

import { db } from '@db/drizzle';

/** Lo reescrito por una empresa. `null` en un bloque = ese usa el de fábrica. */
export interface OrgEmailTemplateRow {
  emailId: string;
  subject: string | null;
  heading: string | null;
  body: string | null;
  ctaLabel: string | null;
  ctaUrl: string | null;
  footer: string | null;
  updatedAt: Date;
}

const COLUMNAS = {
  emailId: schema.organizationEmailTemplate.emailId,
  subject: schema.organizationEmailTemplate.subject,
  heading: schema.organizationEmailTemplate.heading,
  body: schema.organizationEmailTemplate.body,
  ctaLabel: schema.organizationEmailTemplate.ctaLabel,
  ctaUrl: schema.organizationEmailTemplate.ctaUrl,
  footer: schema.organizationEmailTemplate.footer,
  updatedAt: schema.organizationEmailTemplate.updatedAt
};

/** Todos los textos que esta empresa reescribió. */
export const getOrgEmailTemplates = async (orgId: string): Promise<OrgEmailTemplateRow[]> => {
  return db
    .select(COLUMNAS)
    .from(schema.organizationEmailTemplate)
    .where(eq(schema.organizationEmailTemplate.organizationId, orgId));
};

/** Un texto puntual. Es el que se consulta en el camino de cada envío. */
export const getOrgEmailTemplate = async (orgId: string, emailId: string): Promise<OrgEmailTemplateRow | null> => {
  const [row] = await db
    .select(COLUMNAS)
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

export interface UpsertOrgEmailTemplateInput {
  orgId: string;
  emailId: string;
  subject: string | null;
  heading: string | null;
  body: string | null;
  ctaLabel: string | null;
  ctaUrl: string | null;
  footer: string | null;
  updatedByProfileId?: string | null;
}

/**
 * Guarda el texto reescrito. `upsert` sobre (empresa, correo) para que dos
 * guardados seguidos no dejen dos filas — el índice único lo garantiza, esto
 * evita el error.
 */
export const upsertOrgEmailTemplate = async (input: UpsertOrgEmailTemplateInput): Promise<void> => {
  const bloques = {
    subject: input.subject,
    heading: input.heading,
    body: input.body,
    ctaLabel: input.ctaLabel,
    ctaUrl: input.ctaUrl,
    footer: input.footer,
    updatedByProfileId: input.updatedByProfileId ?? null
  };

  await db
    .insert(schema.organizationEmailTemplate)
    .values({ organizationId: input.orgId, emailId: input.emailId, ...bloques })
    .onConflictDoUpdate({
      target: [schema.organizationEmailTemplate.organizationId, schema.organizationEmailTemplate.emailId],
      set: { ...bloques, updatedAt: new Date() }
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
