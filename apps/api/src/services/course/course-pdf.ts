import katex from 'katex';

import {
  getCourseForPdf,
  type TCoursePdfData,
  type TCoursePdfExercise,
  type TCoursePdfLesson,
  type TCoursePdfMedia,
  type TCoursePdfQuestion
} from '@cio/db/queries/course';
import type { TCoursePdfExercises, TCoursePdfScope } from '@cio/utils/validation/course';

import { AppError, ErrorCodes } from '@api/utils/errors';
import { renderPdf } from '@api/utils/render';
import { sanitizeHtml } from '@api/utils/sanitize-html';

export interface CoursePdfOptions {
  scope: TCoursePdfScope;
  exercises: TCoursePdfExercises;
}

type Item = { kind: 'lesson'; lesson: TCoursePdfLesson } | { kind: 'exercise'; exercise: TCoursePdfExercise };

interface Block {
  number: number;
  title: string;
  items: Item[];
}

const OPTION_TYPES = new Set(['RADIO', 'CHECKBOX', 'TRUE_FALSE']);

export function escapeHtml(value: string | null | undefined): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function unescapeAttribute(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function attribute(tag: string, name: string): string | null {
  const match = tag.match(new RegExp(`\\s${name}="([^"]*)"`));
  return match ? unescapeAttribute(match[1]) : null;
}

const byOrder = (a: { order: number | null }, b: { order: number | null }) =>
  (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER);

/**
 * Sections in order, each with its lessons and exercises interleaved by their
 * own order, the way the course outline shows them. An exercise that only
 * points at a lesson goes right after it; anything without a known section
 * goes in a trailing block so nothing is silently left out.
 */
export function arrangeCourse(data: TCoursePdfData): Block[] {
  const sections = [...data.sections].sort(byOrder);
  const known = new Set(sections.map((section) => section.id));
  const lessonSection = new Map(data.lessons.map((lesson) => [lesson.id, lesson.sectionId]));

  const sectionOf = (item: Item): string | null => {
    if (item.kind === 'lesson') return item.lesson.sectionId;
    return item.exercise.sectionId ?? (item.exercise.lessonId ? (lessonSection.get(item.exercise.lessonId) ?? null) : null);
  };

  const itemsFor = (sectionId: string | null): Item[] => {
    const lessons = data.lessons
      .filter((lesson) => (sectionId === null ? !lesson.sectionId || !known.has(lesson.sectionId) : lesson.sectionId === sectionId))
      .sort(byOrder);
    const exercises = data.exercises.filter((exercise) => {
      const target = sectionOf({ kind: 'exercise', exercise });
      return sectionId === null ? !target || !known.has(target) : target === sectionId;
    });

    const placed: Item[] = [];
    const sectionLevel = exercises.filter((exercise) => exercise.sectionId).sort(byOrder);
    const merged = [
      ...lessons.map((lesson) => ({ order: lesson.order, item: { kind: 'lesson', lesson } as Item })),
      ...sectionLevel.map((exercise) => ({ order: exercise.order, item: { kind: 'exercise', exercise } as Item }))
    ].sort((a, b) => byOrder(a, b) || (a.item.kind === 'lesson' ? -1 : 1));

    for (const { item } of merged) {
      placed.push(item);
      if (item.kind === 'lesson') {
        for (const exercise of exercises.filter((e) => !e.sectionId && e.lessonId === item.lesson.id).sort(byOrder)) {
          placed.push({ kind: 'exercise', exercise });
        }
      }
    }

    return placed;
  };

  const blocks: Block[] = sections.map((section, index) => ({
    number: index + 1,
    title: section.title?.trim() || `Sección ${index + 1}`,
    items: itemsFor(section.id)
  }));

  const loose = itemsFor(null);
  if (loose.length > 0) {
    blocks.push({ number: blocks.length + 1, title: 'Otros contenidos', items: loose });
  }

  return blocks;
}

function renderFormula(latex: string, displayMode: boolean): string {
  return katex.renderToString(latex, { output: 'mathml', throwOnError: false, displayMode });
}

function mediaLabel(kind: string, mediaId: string, lesson: TCoursePdfLesson): string {
  if (kind === 'slide') return `Diapositivas: ${escapeHtml(lesson.slideUrl ?? '')}`;

  const list: TCoursePdfMedia[] = kind === 'video' ? lesson.videos : lesson.documents;
  const media = list.find((item) => item?.id === mediaId);
  const name = media?.name || media?.link || '';
  const what = kind === 'video' ? 'Video' : 'Documento';

  return name ? `${what}: ${escapeHtml(name)}` : `${what} adjunto`;
}

/**
 * Teacher-written HTML, made safe to hand to the server's own browser.
 *
 * Sanitised first and only then extended: the shared sanitiser forbids `<math>`,
 * so formulas are drawn after it, from the `data-latex` it kept. Images only
 * load over https or inline, so lesson HTML cannot make the server request an
 * internal address.
 */
export function prepareLessonHtml(html: string, lesson: TCoursePdfLesson): string {
  let clean = sanitizeHtml(html);

  clean = clean.replace(
    /<(span|div)\b([^>]*\sdata-type="(inline-math|block-math)"[^>]*)>[\s\S]*?<\/\1>/g,
    (whole, _tag: string, attrs: string, type: string) => {
      const latex = attribute(` ${attrs}`, 'data-latex');
      return latex === null ? whole : renderFormula(latex, type === 'block-math');
    }
  );

  clean = clean.replace(/<div\b([^>]*\sdata-cio-media="[^"]*"[^>]*)>\s*<\/div>/g, (_whole, attrs: string) => {
    const kind = attribute(` ${attrs}`, 'data-cio-media') ?? 'document';
    const mediaId = attribute(` ${attrs}`, 'data-cio-media-id') ?? '';
    return `<p class="material">${mediaLabel(kind, mediaId, lesson)}</p>`;
  });

  clean = clean.replace(/<img\b[^>]*>/g, (tag) => {
    const src = attribute(tag, 'src') ?? '';
    return /^https:\/\//i.test(src) || /^data:image\//i.test(src) ? tag : '';
  });

  return clean;
}

function formatNumber(value: unknown): string {
  const number = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));
  return Number.isFinite(number) ? number.toLocaleString('es-AR') : escapeHtml(String(value));
}

function renderQuestion(question: TCoursePdfQuestion, withAnswers: boolean): string {
  const type = question.typename ?? '';
  const title = sanitizeHtml(question.title);
  let body = '';

  if (OPTION_TYPES.has(type) && question.options.length > 0) {
    const shape = type === 'CHECKBOX' ? 'cuadro' : 'circulo';
    const options = question.options
      .map((option) => {
        const correct = withAnswers && option.isCorrect;
        return `<li class="opcion${correct ? ' correcta' : ''}"><span class="marca ${shape}"></span><span>${escapeHtml(option.label)}${
          correct ? ' <span class="etiqueta-correcta">(correcta)</span>' : ''
        }</span></li>`;
      })
      .join('');
    body = `<ul class="opciones">${options}</ul>`;
  } else if (type === 'NUMERIC') {
    const { correctValue, tolerance } = question.settings as { correctValue?: unknown; tolerance?: unknown };
    body =
      withAnswers && correctValue !== undefined && correctValue !== null && correctValue !== ''
        ? `<p class="respuesta">Respuesta: ${formatNumber(correctValue)}${
            tolerance ? ` (± ${formatNumber(tolerance)})` : ''
          }</p>`
        : '<p class="respuesta-vacia">Respuesta numérica</p>';
  } else if (type === 'SHORT_ANSWER') {
    const answers = (question.settings as { correctAnswers?: unknown }).correctAnswers;
    body =
      withAnswers && Array.isArray(answers) && answers.length > 0
        ? `<p class="respuesta">Respuestas aceptadas: ${answers.map((answer) => escapeHtml(String(answer))).join(', ')}</p>`
        : '<p class="respuesta-vacia">Respuesta corta</p>';
  } else {
    body = '<p class="respuesta-vacia">Respuesta abierta</p>';
  }

  return `<li class="pregunta"><div class="enunciado">${title}</div>${body}</li>`;
}

function renderExercise(exercise: TCoursePdfExercise, withAnswers: boolean): string {
  const description = exercise.description ? `<div class="descripcion">${sanitizeHtml(exercise.description)}</div>` : '';
  const questions =
    exercise.questions.length > 0
      ? `<ol class="preguntas">${[...exercise.questions].sort(byOrder).map((q) => renderQuestion(q, withAnswers)).join('')}</ol>`
      : '<p class="respuesta-vacia">Sin preguntas cargadas.</p>';

  return `<section class="ejercicio"><h3>Evaluación: ${escapeHtml(exercise.title)}</h3>${description}${questions}</section>`;
}

function lessonMaterials(lesson: TCoursePdfLesson): string {
  const lines = [
    ...lesson.documents.map((doc) => `Documento: ${escapeHtml(doc?.name || doc?.link || '')}`),
    ...lesson.videos.map((video) => `Video: ${escapeHtml(video?.name || video?.link || '')}`),
    ...(lesson.slideUrl ? [`Diapositivas: ${escapeHtml(lesson.slideUrl)}`] : [])
  ];

  return lines.length > 0
    ? `<div class="materiales"><p class="titulo-materiales">Materiales de la lección</p><ul>${lines.map((line) => `<li>${line}</li>`).join('')}</ul></div>`
    : '';
}

function countQuestions(exercise: TCoursePdfExercise): string {
  const n = exercise.questions.length;
  return n === 1 ? '1 pregunta' : `${n} preguntas`;
}

function formatDate(now: Date): string {
  return new Intl.DateTimeFormat('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  }).format(now);
}

const STYLES = `
  @page {
    size: A4;
    margin: 18mm 16mm 20mm;
    @bottom-center {
      content: counter(page) " / " counter(pages);
      font-family: Arial, Helvetica, "Liberation Sans", "DejaVu Sans", sans-serif;
      font-size: 9pt;
      color: #6b7280;
    }
  }
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, "Liberation Sans", "DejaVu Sans", sans-serif; font-size: 10.5pt; line-height: 1.5; color: #111827; margin: 0; }
  h1 { font-size: 24pt; line-height: 1.2; margin: 0 0 8pt; }
  h2 { font-size: 16pt; margin: 18pt 0 8pt; }
  h3 { font-size: 13pt; margin: 14pt 0 6pt; }
  h4 { font-size: 11.5pt; margin: 12pt 0 4pt; }
  h5 { font-size: 10.5pt; margin: 10pt 0 4pt; }
  p { margin: 0 0 6pt; }
  ul, ol { margin: 0 0 6pt; padding-left: 18pt; }
  table { border-collapse: collapse; width: 100%; margin: 6pt 0 10pt; font-size: 9.5pt; }
  th, td { border: 1px solid #d1d5db; padding: 4pt 6pt; text-align: left; vertical-align: top; }
  th { background: #f3f4f6; }
  tr, svg, img, pre, blockquote, .pregunta, .material { break-inside: avoid; }
  svg, img { max-width: 100%; height: auto; }
  pre { background: #f3f4f6; padding: 6pt 8pt; white-space: pre-wrap; font-size: 9pt; }
  code { font-family: "Courier New", "Liberation Mono", monospace; font-size: 9.5pt; }
  blockquote { border-left: 3px solid #d1d5db; margin: 6pt 0; padding: 2pt 0 2pt 10pt; color: #374151; }
  a { color: #1d4ed8; text-decoration: none; }
  math { font-size: 1.05em; }
  .portada { padding-top: 40mm; break-after: page; }
  .portada .empresa { font-size: 11pt; text-transform: uppercase; letter-spacing: 0.08em; color: #6b7280; }
  .portada .tipo { font-size: 14pt; color: #374151; margin-top: 4pt; }
  .portada .resumen { margin-top: 18pt; color: #374151; }
  .portada .fecha { color: #6b7280; font-size: 9.5pt; }
  .presentacion { margin-bottom: 14pt; }
  .temario h3 { margin-top: 12pt; }
  .temario ol { list-style: none; padding-left: 0; }
  .temario li { padding: 2pt 0; border-bottom: 1px solid #f3f4f6; }
  .temario .tipo-item { color: #6b7280; font-size: 9pt; }
  .seccion { break-before: page; }
  .seccion > h2 { border-bottom: 2px solid #111827; padding-bottom: 4pt; }
  .leccion { margin-bottom: 16pt; }
  .leccion > h3 { color: #111827; }
  .material { font-size: 9.5pt; color: #374151; background: #f9fafb; border: 1px dashed #d1d5db; padding: 4pt 8pt; }
  .materiales { font-size: 9.5pt; color: #374151; border-top: 1px solid #e5e7eb; margin-top: 8pt; padding-top: 4pt; }
  .titulo-materiales { font-weight: bold; }
  .ejercicio { border: 1px solid #e5e7eb; border-radius: 4pt; padding: 8pt 12pt; margin: 12pt 0; }
  .ejercicio > h3 { margin-top: 2pt; }
  .preguntas { padding-left: 16pt; }
  .pregunta { margin-bottom: 8pt; }
  .opciones { list-style: none; padding-left: 4pt; margin-top: 3pt; }
  .opcion { display: flex; align-items: baseline; gap: 6pt; padding: 1pt 0; }
  .marca { display: inline-block; flex: none; width: 8pt; height: 8pt; border: 1px solid #6b7280; position: relative; top: 1pt; }
  .marca.circulo { border-radius: 50%; }
  .opcion.correcta .marca { background: #15803d; border-color: #15803d; }
  .etiqueta-correcta { color: #15803d; font-size: 9pt; font-weight: bold; }
  .respuesta { color: #15803d; font-weight: bold; }
  .respuesta-vacia { color: #6b7280; font-style: italic; font-size: 9.5pt; }
  .anexo { break-before: page; }
`;

/** The whole printable document. Pure: same data and options, same HTML. */
export function buildCoursePdfHtml(data: TCoursePdfData, options: CoursePdfOptions, now: Date): string {
  const blocks = arrangeCourse(data);
  const withAnswers = options.exercises === 'answers';
  const showExercises = options.exercises !== 'none';

  const lessonCount = data.lessons.length;
  const exerciseCount = data.exercises.length;
  const summary = [
    `${blocks.length} ${blocks.length === 1 ? 'sección' : 'secciones'}`,
    `${lessonCount} ${lessonCount === 1 ? 'lección' : 'lecciones'}`,
    `${exerciseCount} ${exerciseCount === 1 ? 'evaluación' : 'evaluaciones'}`
  ].join(' · ');

  const cover = `<header class="portada">
    ${data.course.orgName ? `<p class="empresa">${escapeHtml(data.course.orgName)}</p>` : ''}
    <h1>${escapeHtml(data.course.title)}</h1>
    <p class="tipo">${options.scope === 'outline' ? 'Temario del curso' : 'Contenido del curso'}</p>
    <p class="resumen">${summary}</p>
    <p class="fecha">Generado el ${formatDate(now)}</p>
  </header>`;

  const metadata = data.course.metadata as { goals?: unknown; requirements?: unknown };
  const goals = typeof metadata.goals === 'string' && metadata.goals.trim() ? metadata.goals : '';
  const requirements = typeof metadata.requirements === 'string' && metadata.requirements.trim() ? metadata.requirements : '';
  const presentation = [
    data.course.description?.trim()
      ? `<h2>Descripción</h2><p>${escapeHtml(data.course.description.trim()).replace(/\n/g, '<br>')}</p>`
      : '',
    goals ? `<h2>Objetivos</h2>${sanitizeHtml(goals)}` : '',
    requirements ? `<h2>Requisitos</h2>${sanitizeHtml(requirements)}` : ''
  ].join('');

  const outline = blocks
    .map((block) => {
      let lessonNumber = 0;
      const items = block.items
        .map((item) => {
          if (item.kind === 'lesson') {
            lessonNumber += 1;
            return `<li>${block.number}.${lessonNumber} ${escapeHtml(item.lesson.title)}</li>`;
          }
          return `<li>Evaluación: ${escapeHtml(item.exercise.title)} <span class="tipo-item">(${countQuestions(item.exercise)})</span></li>`;
        })
        .join('');
      return `<h3>Sección ${block.number}. ${escapeHtml(block.title)}</h3><ol>${items}</ol>`;
    })
    .join('');

  let body = `<section class="presentacion">${presentation}</section><section class="temario"><h2>Temario</h2>${outline}</section>`;

  if (options.scope === 'full') {
    body += blocks
      .map((block) => {
        let lessonNumber = 0;
        const items = block.items
          .map((item) => {
            if (item.kind === 'exercise') {
              return showExercises ? renderExercise(item.exercise, withAnswers) : '';
            }
            lessonNumber += 1;
            const content = item.lesson.content ? prepareLessonHtml(item.lesson.content, item.lesson) : '';
            return `<article class="leccion"><h3>${block.number}.${lessonNumber} ${escapeHtml(item.lesson.title)}</h3>${content}${lessonMaterials(item.lesson)}</article>`;
          })
          .join('');
        return `<section class="seccion"><h2>Sección ${block.number}. ${escapeHtml(block.title)}</h2>${items}</section>`;
      })
      .join('');
  } else if (showExercises && exerciseCount > 0) {
    const annex = blocks
      .flatMap((block) => block.items)
      .filter((item): item is Extract<Item, { kind: 'exercise' }> => item.kind === 'exercise')
      .map((item) => renderExercise(item.exercise, withAnswers))
      .join('');
    body += `<section class="anexo"><h2>Evaluaciones</h2>${annex}</section>`;
  }

  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>${escapeHtml(
    data.course.title
  )}</title><style>${STYLES}</style></head><body>${cover}${body}</body></html>`;
}

export async function generateCoursePdf(
  courseId: string,
  options: CoursePdfOptions,
  now: Date = new Date()
): Promise<{ pdf: Buffer; title: string }> {
  const data = await getCourseForPdf(courseId);

  if (!data) {
    throw new AppError('Course not found', ErrorCodes.COURSE_NOT_FOUND, 404);
  }

  const pdf = await renderPdf(buildCoursePdfHtml(data, options, now), undefined, {
    format: 'A4',
    printBackground: true,
    preferCSSPageSize: true
  });

  return { pdf, title: data.course.title };
}
