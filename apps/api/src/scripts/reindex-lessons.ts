/**
 * Indexes lesson text that has no embeddings, so the learner tutor can find it.
 *
 * `search_course` runs a vector search over `lesson_embedding`. A lesson whose
 * text was never indexed is invisible to it — and invisibly so: the tutor gets
 * an empty result and tells the learner the material is not in the course.
 * Lessons written before the RAG feature existed, or whose indexing pass failed
 * in the background, sit in exactly that state.
 *
 * From here on `lesson-language.ts` and `clone.ts` index on write, so this only
 * has to catch what predates them or slipped through.
 *
 * Idempotent: only (lesson, locale) pairs with text and NO rows for that locale
 * are touched, so re-running is a no-op. Needs GOOGLE_API_KEY — embeddings come
 * from Google regardless of CHAT_PROVIDER.
 *
 *   pnpm --filter @cio/api agent:reindex-lessons               # dry run
 *   pnpm --filter @cio/api agent:reindex-lessons --execute
 *   pnpm --filter @cio/api agent:reindex-lessons --execute --course <uuid>
 */
import 'dotenv/config';

import { sql } from 'drizzle-orm';

import { db } from '@cio/db';
import type { TLocale } from '@db/types';

import { indexLessonLanguage } from '@api/services/agent/embeddings';

const args = process.argv.slice(2);
const shouldExecute = args.includes('--execute');
const courseFilter = args[args.indexOf('--course') + 1];
const onlyCourse = args.includes('--course') ? courseFilter : null;

interface Pendiente {
  lesson_id: string;
  course_id: string;
  locale: string;
  title: string;
  content: string;
}

async function main() {
  if (!process.env.GOOGLE_API_KEY) {
    console.error('✗ GOOGLE_API_KEY no está configurada — sin ella no hay embeddings que escribir.');
    process.exit(1);
  }

  // A lesson counts as unindexed when it has text in a locale and not a single
  // chunk for that same locale. Comparing per (lesson, locale) matters: a lesson
  // indexed in `en` but written in `es` is still invisible to a Spanish course.
  const pendientes = (await db.execute(sql`
    SELECT ll.lesson_id, l.course_id, ll.locale, l.title, ll.content
    FROM lesson_language ll
    JOIN lesson l ON l.id = ll.lesson_id
    WHERE coalesce(ll.content, '') <> ''
      ${onlyCourse ? sql`AND l.course_id = ${onlyCourse}` : sql``}
      AND NOT EXISTS (
        SELECT 1 FROM lesson_embedding le
        WHERE le.lesson_id = ll.lesson_id AND le.locale = ll.locale
      )
    ORDER BY l.course_id, ll.locale
  `)) as unknown as Pendiente[];

  if (pendientes.length === 0) {
    console.log('✓ No hay lecciones sin indexar. Nada que hacer.');
    return;
  }

  const porLocale = new Map<string, number>();
  for (const p of pendientes) porLocale.set(p.locale, (porLocale.get(p.locale) ?? 0) + 1);

  console.log(`${pendientes.length} par(es) (lección, idioma) sin indexar:`);
  for (const [locale, n] of porLocale) console.log(`  ${locale}: ${n}`);

  if (!shouldExecute) {
    console.log('\nEnsayo. Volvé a correrlo con --execute para escribir los embeddings.');
    for (const p of pendientes.slice(0, 20)) {
      console.log(`  [${p.locale}] ${p.title} (${p.content.length} chars)`);
    }
    if (pendientes.length > 20) console.log(`  … y ${pendientes.length - 20} más`);
    return;
  }

  let indexadas = 0;
  let trozos = 0;
  let fallas = 0;

  for (const p of pendientes) {
    try {
      const { indexed } = await indexLessonLanguage({
        lessonId: p.lesson_id,
        courseId: p.course_id,
        locale: p.locale as TLocale,
        content: p.content
      });

      if (indexed > 0) {
        indexadas += 1;
        trozos += indexed;
        console.log(`  ✓ [${p.locale}] ${p.title} → ${indexed} trozo(s)`);
      } else {
        console.log(`  · [${p.locale}] ${p.title} → sin texto útil tras limpiar el HTML`);
      }
    } catch (err) {
      fallas += 1;
      console.error(`  ✗ [${p.locale}] ${p.title}:`, err instanceof Error ? err.message : err);
    }
  }

  console.log(`\n${indexadas} lección(es) indexada(s), ${trozos} trozo(s), ${fallas} falla(s).`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
