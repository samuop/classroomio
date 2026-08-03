/**
 * Putting the recipient's data into the design's text.
 *
 * A text element stores "Otorgado a {{recipientName}}" and this turns it into
 * "Otorgado a Ana Ruiz". Two rules matter and both are about safety rather than
 * formatting:
 *
 *  1. Substitution happens on the RAW string, and escaping happens after, in
 *     the renderer. Doing it the other way round — escaping the template, then
 *     substituting — would inject unescaped user data into HTML, and a student
 *     called `<script>` is a stored XSS in every certificate the course issues.
 *  2. An unknown token is left visible rather than blanked. A teacher who
 *     mistypes `{{recipentName}}` sees their typo in the preview instead of a
 *     silent gap they only discover on an issued document.
 */
import { BINDING_KEYS, type BindingKey } from './types';
import { getYear } from '../templates/shared';
import type { CertificateRenderData } from '../types';

/** `{{ recipientName }}` — whitespace inside the braces is tolerated. */
const TOKEN_PATTERN = /\{\{\s*([a-zA-Z]+)\s*\}\}/g;

export interface BindingValues extends Record<BindingKey, string> {}

/**
 * The values a document can interpolate, drawn from the render data.
 *
 * `clientName` has no home in `CertificateRenderData` yet — it arrives with the
 * dual-brand work — so it is threaded separately and defaults to empty.
 */
export function buildBindingValues(data: CertificateRenderData, clientName = ''): BindingValues {
  return {
    recipientName: data.recipientName ?? '',
    courseName: data.courseName ?? '',
    courseDescription: data.courseDescription ?? '',
    orgName: data.orgName ?? '',
    clientName,
    date: data.date ?? '',
    // Seals and medals print the year alone. Extracted from the formatted date
    // with the same helper the fixed templates use, so a canvas seal reads the
    // same as the template seal it was seeded from rather than dropping the
    // year entirely.
    year: getYear(data.date),
    certificateId: data.certificateId ?? ''
  };
}

export function isBindingKey(value: string): value is BindingKey {
  return (BINDING_KEYS as readonly string[]).includes(value);
}

/** Replace every `{{token}}` with its value, leaving unknown tokens in place. */
export function substituteBindings(template: string, values: BindingValues): string {
  return template.replace(TOKEN_PATTERN, (match, key: string) =>
    isBindingKey(key) ? values[key] : match
  );
}

/** Which bindings a template string actually uses — the editor lists these. */
export function listBindings(template: string): BindingKey[] {
  const found = new Set<BindingKey>();

  for (const match of template.matchAll(TOKEN_PATTERN)) {
    const key = match[1];
    if (isBindingKey(key)) found.add(key);
  }

  return Array.from(found);
}

/**
 * Worst-case values, for the editor's stress preview.
 *
 * Free positioning means a layout is only as good as the longest data it will
 * ever hold, and a teacher designing with their own short name has no way to
 * discover that. These are real-shaped extremes — a full Spanish compound name,
 * a course title that spells out its whole scope — not lorem ipsum, so what the
 * preview shows is a document that could actually be issued.
 */
export const STRESS_BINDING_VALUES: BindingValues = {
  recipientName: 'María de los Ángeles Fernández Etchegaray',
  courseName: 'Fundamentos de Probabilidad y Estadística Aplicada a la Gestión de Procesos Industriales',
  courseDescription:
    'Programa integral de formación que abarca inferencia estadística, diseño de experimentos, control estadístico de procesos y modelado predictivo aplicado a entornos productivos reales, con evaluación práctica sobre casos de la industria.',
  orgName: 'Consultora de Capacitación y Desarrollo Profesional Tensor Tech',
  clientName: 'Industrias Metalúrgicas del Sur Sociedad Anónima',
  date: '15 de septiembre de 2026',
  year: '2026',
  certificateId: 'N° 2026-09-000148-AR'
};
