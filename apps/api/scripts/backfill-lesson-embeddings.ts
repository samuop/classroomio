#!/usr/bin/env tsx
/**
 * One-off backfill: index every existing lesson's content for the student tutor's
 * semantic search. Safe to re-run — indexLessonLanguage is idempotent (it clears
 * and rewrites the chunks for each lesson/locale).
 *
 * Usage (from repo root):
 *   pnpm --filter @cio/api exec tsx scripts/backfill-lesson-embeddings.ts
 *
 * Requires GOOGLE_API_KEY in the API .env (otherwise it no-ops).
 */
import 'dotenv/config';

import { db } from '@cio/db';
import * as schema from '@cio/db/schema';
import { eq, isNotNull } from 'drizzle-orm';
import { getEmbeddingModel } from '@cio/ai-assistant';
import type { TLocale } from '@db/types';

import { indexLessonLanguage } from '../src/services/agent/embeddings';

async function main() {
  if (!getEmbeddingModel()) {
    console.error('✗ GOOGLE_API_KEY is not set — embeddings are unavailable. Aborting.');
    process.exit(1);
  }

  console.log('Loading lesson languages with content…');

  // Join lessonLanguage → lesson to get the courseId for each row.
  const rows = await db
    .select({
      lessonId: schema.lessonLanguage.lessonId,
      locale: schema.lessonLanguage.locale,
      content: schema.lessonLanguage.content,
      courseId: schema.lesson.courseId
    })
    .from(schema.lessonLanguage)
    .innerJoin(schema.lesson, eq(schema.lessonLanguage.lessonId, schema.lesson.id))
    .where(isNotNull(schema.lessonLanguage.content));

  console.log(`Found ${rows.length} lesson/locale rows to index.`);

  let indexedChunks = 0;
  let processed = 0;
  let skipped = 0;

  for (const row of rows) {
    if (!row.lessonId || !row.courseId || !row.content?.trim()) {
      skipped += 1;
      continue;
    }

    try {
      const { indexed } = await indexLessonLanguage({
        lessonId: row.lessonId,
        courseId: row.courseId,
        locale: (row.locale ?? 'en') as TLocale,
        content: row.content
      });
      indexedChunks += indexed;
      processed += 1;
      if (processed % 10 === 0) {
        console.log(`  …${processed}/${rows.length} lessons (${indexedChunks} chunks)`);
      }
    } catch (error) {
      console.warn(`  ⚠ failed lesson ${row.lessonId} (${row.locale}):`, error instanceof Error ? error.message : error);
      skipped += 1;
    }
  }

  console.log(`\n✓ Done. Indexed ${processed} lessons → ${indexedChunks} chunks. Skipped ${skipped}.`);
  process.exit(0);
}

main().catch((error) => {
  console.error('Backfill failed:', error);
  process.exit(1);
});
