import ExcelJS from 'exceljs';

import { getCourseReportData, type TCourseReportData, type TCourseReportSubmission } from '@cio/db/queries/course';
import type { TCourseReportFormat } from '@cio/utils/validation/course';

import { escapeHtml } from '@api/services/course/course-pdf';
import { getGradebook, type GradebookExercise } from '@api/services/mark/gradebook';
import { resolveOrgBrand } from '@api/services/organization/org-brand';
import { formatDisplayDateTime } from '@api/utils/display-date';
import { AppError, ErrorCodes } from '@api/utils/errors';
import { renderPdf } from '@api/utils/render';

/**
 * El reporte de alumnos de un curso: quién lo hizo y con qué nota.
 *
 * Lo pidió la consultora para entregarle a su cliente. Sale de la misma tabla en
 * dos formatos: la planilla, para que la docente filtre y haga cuentas, y el PDF,
 * para presentarlo.
 *
 * Las reglas viven en `buildCourseReport` y en ningún otro lado:
 *
 *  - **Terminó**: completó todas las lecciones y entregó todos los ejercicios. Es
 *    la cuenta del seguimiento y no la del certificado: un curso sin certificado
 *    configurado nunca guarda `certificateEarnedAt`, y el reporte diría que
 *    nadie terminó.
 *  - **No empezó**: ni una lección completada ni una entrega.
 *  - **La nota final** sale sólo cuando entregó todo y todo está corregido. Con
 *    lo que falta contado como cero, un alumno a mitad de camino figuraría
 *    desaprobado.
 *  - **Los invitados que todavía no entraron** también aparecen: son a los que
 *    hay que ir a buscar.
 *  - **Sólo cuenta lo habilitado.** Un curso que se habilita por etapas tiene
 *    lecciones y ejercicios bloqueados que el alumno no puede abrir: contados,
 *    nadie terminaba nunca. Lo bloqueado no tiene columna y el reporte lo dice
 *    en una línea.
 */

/** Calificada: el estado 3 del tablero de entregas. */
const GRADED = 3;
const ZONE = 'America/Argentina/Buenos_Aires';

export type ReportStatus = 'finished' | 'in_progress' | 'not_started' | 'invited' | 'invite_expired';

/** El orden de la lista: primero los que terminaron, al final los que nunca entraron. */
const STATUS_ORDER: readonly ReportStatus[] = ['finished', 'in_progress', 'not_started', 'invited', 'invite_expired'];

export const STATUS_LABEL: Record<ReportStatus, string> = {
  finished: 'Terminó',
  in_progress: 'En curso',
  not_started: 'No empezó',
  invited: 'Invitado, no entró',
  invite_expired: 'Invitación vencida'
};

export interface ReportExercise {
  id: string;
  title: string;
  maxPoints: number;
}

/** Puntos que sacó, `'pending'` si falta corregirlo, `null` si no lo entregó. */
export type ReportMark = number | 'pending' | null;

export interface ReportRow {
  name: string;
  email: string;
  status: ReportStatus;
  /** `null` para quien todavía no entró al curso. */
  lessonsCompleted: number | null;
  /** 0–100. `null` si no entró, o si el curso no tiene lecciones. */
  progressPct: number | null;
  /** Uno por ejercicio, en el orden de `CourseReport.exercises`. */
  marks: ReportMark[];
  /** 0–100. */
  finalPct: number | null;
  /** ISO: cuándo cumplió lo último que le faltaba. */
  finishedAt: string | null;
}

export interface CourseReportSummary {
  students: number;
  finished: number;
  inProgress: number;
  notStarted: number;
  /** Invitados que no entraron, con la invitación vigente o vencida. */
  invited: number;
  /** Promedio de la nota final de quienes la tienen. */
  averageFinalPct: number | null;
}

export interface CourseReport {
  courseTitle: string;
  orgName: string;
  generatedAt: string;
  /** Lecciones habilitadas. */
  lessonsTotal: number;
  /** Ejercicios habilitados, en el orden del curso. */
  exercises: ReportExercise[];
  /** Lo que el docente todavía no habilitó y por eso no se cuenta. */
  locked: { lessons: number; exercises: number };
  rows: ReportRow[];
  summary: CourseReportSummary;
}

const later = (a: string | null, b: string | null): string | null => (!a ? b : !b ? a : a > b ? a : b);

export function buildCourseReport(
  data: Pick<
    TCourseReportData,
    'lessonsTotal' | 'lockedLessons' | 'lockedExerciseIds' | 'students' | 'submissions' | 'pendingInvites'
  >,
  gradebookExercises: GradebookExercise[],
  options: { courseTitle: string; orgName: string; now: Date }
): CourseReport {
  const lockedExercises = new Set(data.lockedExerciseIds);
  const exercises = gradebookExercises
    .filter((ex) => !lockedExercises.has(ex.id))
    .map((ex) => ({ id: ex.id, title: ex.title, maxPoints: ex.points }));
  const maxTotal = exercises.reduce((sum, ex) => sum + ex.maxPoints, 0);
  const { lessonsTotal } = data;

  // Si alguien entregó dos veces, cuenta la última.
  const lastSubmission = new Map<string, TCourseReportSubmission>();
  for (const submission of data.submissions) {
    const key = `${submission.groupMemberId}:${submission.exerciseId}`;
    const previous = lastSubmission.get(key);
    if (!previous || submission.submittedAt > previous.submittedAt) lastSubmission.set(key, submission);
  }

  const students: ReportRow[] = data.students.map((student) => {
    const submissions = exercises.map((ex) => lastSubmission.get(`${student.groupMemberId}:${ex.id}`) ?? null);
    const marks: ReportMark[] = submissions.map((s) =>
      s === null ? null : s.statusId === GRADED ? (s.total ?? 0) : 'pending'
    );
    const submitted = submissions.filter((s) => s !== null).length;
    const lessonsCompleted = Math.min(student.lessonsCompleted, lessonsTotal);

    const finished =
      lessonsTotal + exercises.length > 0 && lessonsCompleted === lessonsTotal && submitted === exercises.length;
    const status: ReportStatus = finished
      ? 'finished'
      : lessonsCompleted === 0 && submitted === 0
        ? 'not_started'
        : 'in_progress';

    // Entregado y corregido: lo no entregado (`null`) tampoco es un número.
    const allGraded = marks.every((m) => typeof m === 'number');
    const earned = marks.reduce<number>((sum, m) => sum + (typeof m === 'number' ? m : 0), 0);

    return {
      name: student.fullname,
      email: student.email,
      status,
      lessonsCompleted,
      progressPct: lessonsTotal > 0 ? Math.round((lessonsCompleted / lessonsTotal) * 100) : null,
      marks,
      finalPct: allGraded && maxTotal > 0 ? Math.round((earned / maxTotal) * 100) : null,
      finishedAt: finished
        ? submissions.reduce<string | null>((at, s) => later(at, s?.submittedAt ?? null), student.lastLessonCompletedAt)
        : null
    };
  });

  // Quien ya está en el curso no aparece dos veces por una invitación vieja.
  const enrolled = new Set(data.students.map((s) => s.email.toLowerCase()));
  const invited: ReportRow[] = data.pendingInvites
    .filter((invite) => !enrolled.has(invite.email.toLowerCase()))
    .map((invite) => ({
      name: '',
      email: invite.email,
      status: new Date(invite.expiresAt).getTime() < options.now.getTime() ? 'invite_expired' : 'invited',
      lessonsCompleted: null,
      progressPct: null,
      marks: exercises.map(() => null),
      finalPct: null,
      finishedAt: null
    }));

  const collator = new Intl.Collator('es', { sensitivity: 'base' });
  const rows = [...students, ...invited].sort(
    (a, b) =>
      STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) ||
      collator.compare(a.name || a.email, b.name || b.email)
  );

  const count = (status: ReportStatus) => rows.filter((r) => r.status === status).length;
  const finals = rows.flatMap((r) => (r.finalPct === null ? [] : [r.finalPct]));

  return {
    courseTitle: options.courseTitle,
    orgName: options.orgName,
    generatedAt: options.now.toISOString(),
    lessonsTotal,
    exercises,
    locked: { lessons: data.lockedLessons, exercises: lockedExercises.size },
    rows,
    summary: {
      students: students.length,
      finished: count('finished'),
      inProgress: count('in_progress'),
      notStarted: count('not_started'),
      invited: count('invited') + count('invite_expired'),
      averageFinalPct: finals.length > 0 ? Math.round(finals.reduce((a, b) => a + b, 0) / finals.length) : null
    }
  };
}

/** «51 alumnos: 29 terminaron, 19 en curso, 3 no empezaron · …». */
export function summaryLine(summary: CourseReportSummary): string {
  const { students, finished, inProgress, notStarted, invited, averageFinalPct } = summary;
  const parts = [
    `${students} ${students === 1 ? 'alumno' : 'alumnos'}: ${finished} ${finished === 1 ? 'terminó' : 'terminaron'}, ` +
      `${inProgress} en curso, ${notStarted} ${notStarted === 1 ? 'no empezó' : 'no empezaron'}`
  ];

  if (invited > 0) {
    parts.push(`${invited} ${invited === 1 ? 'invitado que todavía no entró' : 'invitados que todavía no entraron'}`);
  }
  if (averageFinalPct !== null) {
    parts.push(`nota final promedio: ${averageFinalPct} %`);
  }

  return parts.join(' · ');
}

/** «Todavía bloqueado para los alumnos, no se cuenta: 12 lecciones y 3 ejercicios.», o `null`. */
export function lockedLine(locked: CourseReport['locked']): string | null {
  const parts = [
    locked.lessons > 0 ? `${locked.lessons} ${locked.lessons === 1 ? 'lección' : 'lecciones'}` : '',
    locked.exercises > 0 ? `${locked.exercises} ${locked.exercises === 1 ? 'ejercicio' : 'ejercicios'}` : ''
  ].filter(Boolean);

  return parts.length === 0 ? null : `Todavía bloqueado para los alumnos, no se cuenta: ${parts.join(' y ')}.`;
}

/** «31/10/2026»: el día en Argentina. */
export function formatDay(iso: string): string {
  return new Intl.DateTimeFormat('es-AR', { timeZone: ZONE, day: '2-digit', month: '2-digit', year: 'numeric' }).format(
    new Date(iso)
  );
}

/**
 * El mismo día, como fecha de Excel.
 *
 * Excel no tiene zona horaria: guarda el día y la hora tal cual. Se arma con las
 * partes del día en Argentina; con el instante en UTC, quien terminó a las 22
 * figuraría al día siguiente.
 */
export function excelDay(iso: string): Date {
  const [year, month, day] = new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  })
    .format(new Date(iso))
    .split('-')
    .map(Number);

  return new Date(Date.UTC(year!, month! - 1, day!));
}

export function formatMark(mark: ReportMark, maxPoints: number): string {
  if (mark === null) return '—';
  if (mark === 'pending') return 'Sin corregir';
  return `${mark}/${maxPoints}`;
}

export async function courseReportXlsx(report: CourseReport): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = report.orgName;
  workbook.created = new Date(report.generatedAt);

  const sheet = workbook.addWorksheet('Alumnos');
  sheet.addRow([`Reporte de alumnos — ${report.courseTitle}`]).font = { bold: true, size: 14 };
  sheet.addRow([`${report.orgName} · Generado el ${formatDisplayDateTime(report.generatedAt)}`]);
  sheet.addRow([summaryLine(report.summary)]);
  const locked = lockedLine(report.locked);
  if (locked) {
    sheet.addRow([locked]).font = { italic: true };
  } else {
    sheet.addRow([]);
  }

  const header = sheet.addRow([
    'Alumno',
    'Correo',
    'Estado',
    'Avance',
    `Lecciones (de ${report.lessonsTotal})`,
    ...report.exercises.map((ex) => `${ex.title} (sobre ${ex.maxPoints})`),
    'Nota final',
    'Terminó el'
  ]);
  header.font = { bold: true };
  header.alignment = { wrapText: true, vertical: 'top' };
  header.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDEFF2' } };
  });

  // Números de verdad, no texto: así se ordena, se filtra y se promedia en Excel.
  for (const row of report.rows) {
    sheet.addRow([
      row.name,
      row.email,
      STATUS_LABEL[row.status],
      row.progressPct === null ? null : row.progressPct / 100,
      row.lessonsCompleted,
      ...row.marks.map((mark) => (mark === 'pending' ? 'Sin corregir' : mark)),
      row.finalPct === null ? null : row.finalPct / 100,
      row.finishedAt ? excelDay(row.finishedAt) : null
    ]);
  }

  const finalColumn = 6 + report.exercises.length;
  const dateColumn = finalColumn + 1;

  sheet.getColumn(1).width = 30;
  sheet.getColumn(2).width = 32;
  sheet.getColumn(3).width = 18;
  sheet.getColumn(4).width = 10;
  sheet.getColumn(4).numFmt = '0%';
  sheet.getColumn(5).width = 14;
  report.exercises.forEach((_, index) => {
    sheet.getColumn(6 + index).width = 22;
  });
  sheet.getColumn(finalColumn).width = 11;
  sheet.getColumn(finalColumn).numFmt = '0%';
  sheet.getColumn(dateColumn).width = 12;
  sheet.getColumn(dateColumn).numFmt = 'dd/mm/yyyy';

  sheet.autoFilter = { from: { row: header.number, column: 1 }, to: { row: header.number, column: dateColumn } };
  sheet.views = [{ state: 'frozen', ySplit: header.number }];

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

const PDF_STYLES = `
  @page { size: A4 landscape; margin: 14mm 12mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 9pt; color: #1f2933; }
  header { display: flex; align-items: center; gap: 14px; margin-bottom: 4px; }
  header img { max-height: 42px; max-width: 170px; object-fit: contain; }
  .empresa { margin: 0; font-size: 10pt; color: #52606d; }
  h1 { margin: 0; font-size: 17pt; }
  .curso { margin: 2px 0 0; font-size: 12pt; }
  .meta { margin: 8px 0 2px; color: #52606d; }
  .resumen { margin: 0 0 12px; font-weight: 600; }
  .bloqueado { margin: -8px 0 12px; font-style: italic; color: #52606d; }
  table { width: 100%; border-collapse: collapse; }
  thead th {
    padding: 5px 6px; border-bottom: 1.5px solid #9aa5b1; text-align: left; vertical-align: bottom;
    font-size: 7.5pt; font-weight: 600; color: #52606d;
  }
  tbody td { padding: 5px 6px; border-bottom: 1px solid #e4e7eb; vertical-align: top; }
  tbody tr { break-inside: avoid; }
  tbody tr:nth-child(even) td { background: #f7f8fa; }
  .num { text-align: right; white-space: nowrap; }
  .ej { text-align: center; white-space: nowrap; }
  thead th.ej { white-space: normal; }
  .correo { color: #7b8794; font-size: 8pt; }
  .estado { white-space: nowrap; font-weight: 600; }
  .finished { color: #1e7b45; }
  .in_progress { color: #9a6b00; }
  .not_started, .invited, .invite_expired { color: #7b8794; }
`;

export function courseReportHtml(report: CourseReport, logoUrl: string | null): string {
  // Los títulos de los ejercicios son largos: con un ancho fijo bajan de renglón
  // en vez de estirar la columna y dejar la nota lejos de su título.
  const exerciseWidth = Math.min(13, Math.floor(52 / Math.max(1, report.exercises.length)));
  const head = [
    '<th>Alumno</th>',
    '<th>Estado</th>',
    '<th class="num">Avance</th>',
    ...report.exercises.map((ex) => `<th class="ej" style="width: ${exerciseWidth}%">${escapeHtml(ex.title)}</th>`),
    '<th class="num">Nota final</th>',
    '<th class="num">Terminó el</th>'
  ].join('');

  const body = report.rows
    .map((row) => {
      const who = row.name
        ? `${escapeHtml(row.name)}<div class="correo">${escapeHtml(row.email)}</div>`
        : `<span class="correo">${escapeHtml(row.email)}</span>`;
      const progress =
        row.progressPct === null ? '—' : `${row.progressPct} %<div class="correo">${row.lessonsCompleted}/${report.lessonsTotal} lecciones</div>`;

      return `<tr>
        <td>${who}</td>
        <td class="estado ${row.status}">${STATUS_LABEL[row.status]}</td>
        <td class="num">${progress}</td>
        ${row.marks.map((mark, i) => `<td class="ej">${formatMark(mark, report.exercises[i]!.maxPoints)}</td>`).join('')}
        <td class="num">${row.finalPct === null ? '—' : `${row.finalPct} %`}</td>
        <td class="num">${row.finishedAt ? formatDay(row.finishedAt) : '—'}</td>
      </tr>`;
    })
    .join('');

  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>${escapeHtml(
    `Reporte de alumnos — ${report.courseTitle}`
  )}</title><style>${PDF_STYLES}</style></head><body>
    <header>
      ${logoUrl ? `<img src="${escapeHtml(logoUrl)}" alt="">` : ''}
      <div>
        ${report.orgName ? `<p class="empresa">${escapeHtml(report.orgName)}</p>` : ''}
        <h1>Reporte de alumnos</h1>
        <p class="curso">${escapeHtml(report.courseTitle)}</p>
      </div>
    </header>
    <p class="meta">Generado el ${escapeHtml(formatDisplayDateTime(report.generatedAt))}</p>
    <p class="resumen">${escapeHtml(summaryLine(report.summary))}</p>
    ${lockedLine(report.locked) ? `<p class="bloqueado">${escapeHtml(lockedLine(report.locked)!)}</p>` : ''}
    <table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
  </body></html>`;
}

/**
 * El archivo listo para bajar. La empresa se nombra con la marca con que se
 * presenta (ver `org-brand.ts`): el cliente que usa la de su consultora no
 * aparece en su propio reporte.
 */
export async function generateCourseReport(
  courseId: string,
  format: TCourseReportFormat,
  now = new Date()
): Promise<{ file: Buffer; title: string }> {
  const [data, gradebook] = await Promise.all([getCourseReportData(courseId), getGradebook(courseId)]);

  if (!data) {
    throw new AppError('Course not found', ErrorCodes.COURSE_NOT_FOUND, 404);
  }

  const brand = await resolveOrgBrand(data.course.orgId);
  const report = buildCourseReport(data, gradebook.exercises, {
    courseTitle: data.course.title,
    orgName: brand?.name ?? data.course.orgName,
    now
  });

  if (format === 'xlsx') {
    return { file: await courseReportXlsx(report), title: data.course.title };
  }

  const logoUrl = brand ? brand.avatarUrl : data.course.orgAvatarUrl;
  const file = await renderPdf(courseReportHtml(report, logoUrl), undefined, {
    printBackground: true,
    preferCSSPageSize: true
  });

  return { file, title: data.course.title };
}
