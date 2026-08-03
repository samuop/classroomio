/**
 * Stamps a placement id on every lesson media entry that predates them.
 *
 * From here on `updateLesson`/`createLessons` stamp ids on the way into the
 * database, so this only has to catch rows that have not been written since.
 * Idempotent: entries that already carry an id are left exactly as they are, so
 * re-running is a no-op and no lesson is rewritten for nothing.
 *
 *   pnpm --filter @cio/db db:media-ids-backfill              # dry run
 *   pnpm --filter @cio/db db:media-ids-backfill --execute
 */
import * as schema from '../schema';

import { asc, db, eq } from '../drizzle';

import { withLessonMediaIds } from '@cio/utils/functions/lesson-media-id';

const args = new Set(process.argv.slice(2));
const shouldExecute = args.has('--execute');
const isDryRun = !shouldExecute || args.has('--dry-run');
const batchSize = 200;

interface Summary {
  lessonsScanned: number;
  lessonsPatched: number;
  videosScanned: number;
  videosPatched: number;
  documentsScanned: number;
  documentsPatched: number;
  errors: number;
}

const summary: Summary = {
  lessonsScanned: 0,
  lessonsPatched: 0,
  videosScanned: 0,
  videosPatched: 0,
  documentsScanned: 0,
  documentsPatched: 0,
  errors: 0
};

type MediaEntry = { id?: string } & Record<string, unknown>;

function stamp(entries: unknown): { entries: MediaEntry[]; scanned: number; patched: number } | null {
  if (!Array.isArray(entries)) return null;

  const next = withLessonMediaIds(entries as MediaEntry[]);
  // Identity comparison, not a deep one: withLessonMediaIds returns already-
  // stamped entries by reference and only allocates for the ones it changed.
  const patched = next.reduce((count, entry, index) => count + (entry === entries[index] ? 0 : 1), 0);

  return { entries: next, scanned: entries.length, patched };
}

async function backfillLessonMediaIds() {
  console.log(`[media-ids] Starting backfill in ${isDryRun ? 'DRY-RUN' : 'EXECUTE'} mode (batch=${batchSize})`);

  let offset = 0;

  try {
    while (true) {
      const lessons = await db
        .select({
          id: schema.lesson.id,
          videos: schema.lesson.videos,
          documents: schema.lesson.documents
        })
        .from(schema.lesson)
        .orderBy(asc(schema.lesson.id))
        .limit(batchSize)
        .offset(offset);

      if (lessons.length === 0) break;

      for (const lesson of lessons) {
        summary.lessonsScanned += 1;

        try {
          const videos = stamp(lesson.videos);
          const documents = stamp(lesson.documents);

          summary.videosScanned += videos?.scanned ?? 0;
          summary.videosPatched += videos?.patched ?? 0;
          summary.documentsScanned += documents?.scanned ?? 0;
          summary.documentsPatched += documents?.patched ?? 0;

          const needsWrite = (videos?.patched ?? 0) > 0 || (documents?.patched ?? 0) > 0;
          if (!needsWrite) continue;

          summary.lessonsPatched += 1;
          console.log(
            `[media-ids] lesson=${lesson.id} videos=+${videos?.patched ?? 0} documents=+${documents?.patched ?? 0}`
          );

          if (isDryRun) continue;

          // Deliberately not via updateLesson(): that would bump updatedAt, and
          // adding an internal identifier is not an edit to the lesson.
          await db
            .update(schema.lesson)
            .set({
              ...(videos ? { videos: videos.entries as typeof lesson.videos } : {}),
              ...(documents ? { documents: documents.entries as typeof lesson.documents } : {})
            })
            .where(eq(schema.lesson.id, lesson.id));
        } catch (error) {
          summary.errors += 1;
          console.error(`[media-ids] Failed processing lesson ${lesson.id}:`, error);
        }
      }

      offset += lessons.length;
    }

    console.log('[media-ids] Summary:');
    console.log(JSON.stringify(summary, null, 2));
    process.exit(summary.errors > 0 ? 1 : 0);
  } catch (error) {
    console.error('[media-ids] Unhandled backfill failure:', error);
    process.exit(1);
  }
}

backfillLessonMediaIds();
