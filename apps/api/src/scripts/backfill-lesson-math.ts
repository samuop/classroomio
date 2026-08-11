/**
 * Rewrites the formulas of already-stored lessons into KaTeX nodes.
 *
 * `normalizeAgentLessonContent` only runs when the agent writes, so every lesson
 * built before that existed still holds `$\sigma_0^2$` and formulas parked in
 * `<code>` blocks — they reach the learner as literal dollar signs and
 * backslashes. Asking the agent to fix them lesson by lesson costs tokens and,
 * measured on a real course, it stops after one and reports the job done.
 *
 * This is the same conversion, applied directly: `convertMarkdownMathToKatex` is
 * the single implementation, so a lesson repaired here and a lesson written
 * tomorrow end up identical. It is idempotent — a converted lesson has no
 * delimiters left to convert — so re-running is a no-op.
 *
 * Nothing else about the content is touched: no reflow, no sanitising, no SVG
 * repair. A lesson whose formulas are already fine is not rewritten at all.
 *
 *   pnpm --filter @cio/api agent:backfill-lesson-math                      # dry run
 *   pnpm --filter @cio/api agent:backfill-lesson-math --execute
 *   pnpm --filter @cio/api agent:backfill-lesson-math --execute --course <uuid>
 */
import 'dotenv/config';

import { writeFileSync } from 'node:fs';

import { sql } from 'drizzle-orm';

import { db } from '@cio/db';

import { convertMarkdownMathToKatex, validateLessonMath } from '@api/services/agent/lesson-content';

const args = process.argv.slice(2);
const shouldExecute = args.includes('--execute');
const onlyCourse = args.includes('--course') ? args[args.indexOf('--course') + 1] : null;

interface Fila {
  id: number;
  lesson_id: string;
  course_id: string;
  locale: string;
  title: string;
  content: string;
}

function contar(html: string, patron: RegExp): number {
  return [...html.matchAll(patron)].length;
}

/** What changed, in the terms the defect was reported in. */
function resumirCambio(antes: string, despues: string): string {
  const pesos = contar(antes, /\$/g) - contar(despues, /\$/g);
  const codigo = contar(antes, /<code\b/gi) - contar(despues, /<code\b/gi);
  const nodos = contar(despues, /data-type="(?:inline|block)-math"/g) - contar(antes, /data-type="(?:inline|block)-math"/g);

  const partes = [`+${nodos} fórmula(s)`];
  if (pesos > 0) partes.push(`−${pesos} signo(s) $`);
  if (codigo > 0) partes.push(`−${codigo} bloque(s) <code>`);

  return partes.join(', ');
}

async function main() {
  const filas = (await db.execute(sql`
    SELECT ll.id, ll.lesson_id, l.course_id, ll.locale, l.title, ll.content
    FROM lesson_language ll
    JOIN lesson l ON l.id = ll.lesson_id
    WHERE coalesce(ll.content, '') <> ''
      ${onlyCourse ? sql`AND l.course_id = ${onlyCourse}` : sql``}
    ORDER BY l.course_id, l."order" NULLS LAST, ll.locale
  `)) as unknown as Fila[];

  const cambios = filas
    .map((fila) => ({ fila, convertido: convertMarkdownMathToKatex(fila.content) }))
    .filter(({ fila, convertido }) => convertido !== fila.content);

  console.log(`${filas.length} lección(es) con texto revisada(s); ${cambios.length} necesita(n) cambios.`);

  if (cambios.length === 0) {
    console.log('✓ No hay fórmulas en formato markdown. Nada que hacer.');
    return;
  }

  for (const { fila, convertido } of cambios) {
    console.log(`  [${fila.locale}] ${fila.title.slice(0, 50)} → ${resumirCambio(fila.content, convertido)}`);
  }

  // Formulas the conversion cannot reach — LaTeX inside an SVG above all, which
  // has no automatic fix and needs the diagram redrawn.
  const pendientes = cambios.flatMap(({ convertido }) => validateLessonMath(convertido));

  if (pendientes.length > 0) {
    console.log(`\n${pendientes.length} aviso(s) que el relleno NO puede arreglar:`);
    for (const aviso of [...new Set(pendientes)]) console.log(`  · ${aviso}`);
  }

  if (!shouldExecute) {
    console.log('\nEnsayo. Volvé a correrlo con --execute para escribir los cambios.');
    return;
  }

  // The previous content, before anything is written. There is no history row
  // for this table, so this file is the only way back.
  const respaldo = `lesson-math-backup-${Date.now()}.json`;

  writeFileSync(
    respaldo,
    JSON.stringify(
      cambios.map(({ fila }) => ({ id: fila.id, lessonId: fila.lesson_id, locale: fila.locale, content: fila.content })),
      null,
      2
    )
  );

  console.log(`\nRespaldo del contenido anterior en ${respaldo}`);

  let escritas = 0;
  let fallas = 0;

  for (const { fila, convertido } of cambios) {
    try {
      await db.execute(sql`UPDATE lesson_language SET content = ${convertido} WHERE id = ${fila.id}`);
      escritas += 1;
    } catch (err) {
      fallas += 1;
      console.error(`  ✗ [${fila.locale}] ${fila.title}:`, err instanceof Error ? err.message : err);
    }
  }

  console.log(`\n${escritas} lección(es) actualizada(s), ${fallas} falla(s).`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
