import * as schema from '@db/schema';

import type { TLessonLanguage, TLocale, TNewLessonLanguage } from '@db/types';
import { and, desc, eq, lt, sql } from 'drizzle-orm';

import { db } from '@db/drizzle';

export async function getLessonLanguagesByLessonId(lessonId: string): Promise<TLessonLanguage[]> {
  const languages = await db.select().from(schema.lessonLanguage).where(eq(schema.lessonLanguage.lessonId, lessonId));

  return languages;
}

export async function getLessonLanguageByLessonIdAndLocale(
  lessonId: string,
  locale: TLocale
): Promise<TLessonLanguage | null> {
  const [language] = await db
    .select()
    .from(schema.lessonLanguage)
    .where(and(eq(schema.lessonLanguage.lessonId, lessonId), eq(schema.lessonLanguage.locale, locale)))
    .limit(1);

  return language || null;
}

export async function createLessonLanguage(data: TNewLessonLanguage): Promise<TLessonLanguage> {
  const [language] = await db.insert(schema.lessonLanguage).values(data).returning();

  return language;
}

export async function updateLessonLanguage(
  lessonId: string,
  locale: TLocale,
  data: Partial<TNewLessonLanguage>
): Promise<TLessonLanguage> {
  const [language] = await db
    .update(schema.lessonLanguage)
    .set(data)
    .where(and(eq(schema.lessonLanguage.lessonId, lessonId), eq(schema.lessonLanguage.locale, locale)))
    .returning();

  return language;
}

export async function deleteLessonLanguage(lessonId: string, locale: TLocale): Promise<TLessonLanguage | null> {
  const [language] = await db
    .delete(schema.lessonLanguage)
    .where(and(eq(schema.lessonLanguage.lessonId, lessonId), eq(schema.lessonLanguage.locale, locale)))
    .returning();

  return language || null;
}

export async function upsertLessonLanguage(data: TNewLessonLanguage): Promise<TLessonLanguage> {
  // Check if exists
  const existing = await getLessonLanguageByLessonIdAndLocale(data.lessonId!, data.locale || 'en');

  if (existing) {
    return updateLessonLanguage(data.lessonId!, data.locale || 'en', data);
  }

  return createLessonLanguage(data);
}

/** Cuantas versiones se guardan por leccion/idioma antes de podar las mas viejas. */
const HISTORY_LIMIT = 50;

/**
 * Deja constancia de un cambio de contenido en `lesson_language_history`.
 *
 * Esta tabla existia desde el principio, con su vista `lesson_versions` y su
 * pantalla de historial — y **nadie escribia en ella**. La llenaba un trigger de
 * Supabase que no sobrevivio la mudanza a Postgres propio, asi que el historial
 * mostraba una lista vacia y parecia un bug de la pantalla. No lo era: no habia
 * nada que mostrar. Alguien borro una seccion entera, el autoguardado la
 * persistio, y no habia de donde recuperarla.
 *
 * Solo se anota cuando el contenido REALMENTE cambio: el autoguardado dispara
 * muchisimo mas seguido que las ediciones, y una fila por latido no es historial,
 * es ruido. Y se poda a las ultimas `HISTORY_LIMIT`, porque escribir sin techo en
 * cada tecleo llena la tabla en semanas.
 *
 * Nunca hace fallar el guardado: perder una entrada del historial es malo, perder
 * la edicion del docente porque el historial fallo es peor.
 */
export async function recordLessonLanguageHistory(params: {
  lessonLanguageId: number;
  oldContent: string | null;
  newContent: string | null;
}): Promise<void> {
  const { lessonLanguageId, oldContent, newContent } = params;

  if ((oldContent ?? '') === (newContent ?? '')) return;

  try {
    await db.insert(schema.lessonLanguageHistory).values({ lessonLanguageId, oldContent, newContent });

    const [cutoff] = await db
      .select({ id: schema.lessonLanguageHistory.id })
      .from(schema.lessonLanguageHistory)
      .where(eq(schema.lessonLanguageHistory.lessonLanguageId, lessonLanguageId))
      .orderBy(desc(schema.lessonLanguageHistory.id))
      .limit(1)
      .offset(HISTORY_LIMIT);

    if (cutoff) {
      await db
        .delete(schema.lessonLanguageHistory)
        .where(
          and(
            eq(schema.lessonLanguageHistory.lessonLanguageId, lessonLanguageId),
            lt(schema.lessonLanguageHistory.id, sql`${cutoff.id}`)
          )
        );
    }
  } catch {
    // Ver el comentario de arriba: el historial no puede voltear el guardado.
  }
}
