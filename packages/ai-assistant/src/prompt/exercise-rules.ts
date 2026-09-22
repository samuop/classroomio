import { PREMIUM_QUESTION_TYPE_KEYS, QUESTION_TYPE_REGISTRY } from '@cio/question-types';

/**
 * Las reglas de ESCRIBIR las preguntas de un ejercicio, en un solo lugar.
 *
 * Las usan dos lectores: el agente que construye el curso (dentro de su prompt,
 * `teacher.ts`) y el sub-agente que escribe las preguntas de un ejercicio a
 * partir del texto de las lecciones (`question-writer.ts`). Es el mismo motivo
 * —y el mismo acuerdo— que `lesson-rules.ts`: copiarlas sería la salida rápida,
 * y este paquete ya tiene la cicatriz de una regla duplicada cuyo primer
 * arreglo llegó a una sola copia.
 *
 * El texto se movió tal cual: el prompt del constructor queda byte por byte
 * igual, que se comprobó volcándolo antes y después.
 *
 * Lo que NO se movió es el párrafo del examen final integrador: habla de
 * `create_exercise_section` y de armar un bloque por sección previa, o sea de
 * orquestar varias llamadas. El escritor de preguntas escribe UN bloque y no
 * tiene esas herramientas; dárselas de leer sería pedirle algo que no puede
 * hacer. Ese párrafo se quedó en `teacher.ts`, pegado a continuación de esto.
 */
export const EXERCISE_QUALITY_RULES = `## Exercise Quality Bar

When you create an exercise (especially during plan implementation), it must actually verify understanding, not just acknowledge that the lesson was read. Apply these rules:

### Number of questions
- Default to **6–10 questions per exercise** (more for long or content-heavy lessons, fewer only when the lesson is intentionally narrow).
- Cover the full lesson, not just the first section. Spread questions across every <h3>/<h4> sub-section.
- Mix levels of difficulty: ~30% recall, ~50% applied/conceptual, ~20% analytical or scenario-based.

### Options per question (RADIO and CHECKBOX)
- **Minimum of 4 options** per RADIO question; **at least one correct** option, the rest plausible distractors.
- **Minimum of 4 options** per CHECKBOX (multi-select) question; at least 2 correct and at least 1 incorrect distractor.
- Distractors must be plausible — represent common misconceptions or near-miss answers, not obviously wrong filler. Avoid joke options, "all of the above" / "none of the above" as the correct answer, or distractors that are syntactic restatements of the correct one.
- Keep options roughly the same length and grammatical structure; do not let the correct answer stand out by being the longest or most detailed.

### Question writing
- Each question must reference something specific the lesson taught (a concept, a worked example, a definition, a step in a procedure). Do not write questions whose answer cannot be derived from the lesson.
- Prefer scenario / "what would happen if…" / "why does X work this way?" phrasing over rote definition lookup, except for foundational vocabulary checks.
- For TRUE_FALSE: the statement should target a real misconception, not a trivial fact. Use sparingly.
- For NUMERIC / STAR / WORD_BANK: still ensure the answer is unambiguously derivable from the lesson.

### Per-exercise structure
- Vary question types in the same exercise — in exercises with 6+ questions, include **at least three distinct** \`questionTypeId\` values (see Question Types above). Do not output a long exercise of only RADIO unless the teacher explicitly asked for single-choice only.
- Set non-zero \`points\` per question (default 1; harder questions can be 2).`;

/**
 * Los tipos de pregunta que esta organización puede usar, por id.
 *
 * Vive acá y no en `teacher.ts` porque el escritor de preguntas necesita
 * exactamente la misma lista: es él quien elige el tipo de cada una, y una
 * lista distinta de la del constructor significaría preguntas que el plan de la
 * organización no soporta y que el servicio rechaza al guardarlas.
 */
export function buildQuestionTypeListBlock(isOrgOnPaidPlan: boolean): string {
  const allowed = QUESTION_TYPE_REGISTRY.filter((t) => isOrgOnPaidPlan || !PREMIUM_QUESTION_TYPE_KEYS.has(t.key));
  const listing = allowed.map((t) => `- ${t.id} = ${t.typename} — ${t.label}`).join('\n');

  if (isOrgOnPaidPlan) {
    return listing;
  }

  const blocked = QUESTION_TYPE_REGISTRY.filter((t) => PREMIUM_QUESTION_TYPE_KEYS.has(t.key))
    .map((t) => t.typename)
    .join(', ');

  return `${listing}

The following question types require a paid plan and are NOT available on this org: ${blocked}. Do NOT attempt to create them — pick one of the types listed above instead. If the teacher asks for one of these, briefly explain that it requires an upgrade and suggest the closest available type (e.g. RADIO instead of STAR for a rating-style question).`;
}
