/**
 * Las reglas de ESCRIBIR una lección, en un solo lugar.
 *
 * Las usan dos lectores: el agente que construye el curso (dentro de su prompt,
 * `teacher.ts`) y el sub-agente que escribe cada lección con contexto limpio
 * (`lesson-writer.ts`). Estaban escritas una sola vez, dentro del primero; el
 * segundo necesita exactamente las mismas.
 *
 * Copiarlas era la salida rápida y es la que ya salió mal en este paquete: las
 * reglas de SVG terminaron en su propio archivo (`svg-rules.ts`) porque vivían
 * duplicadas y el primer arreglo se aplicó a una sola copia. Con éstas pasaría
 * lo mismo, y más rápido — "cuánto escribir" es justamente lo que se acaba de
 * cambiar (se sacó el piso de palabras). Un cambio así tiene que llegarle a los
 * dos lectores o a ninguno.
 *
 * El texto se movió tal cual: el prompt del constructor queda byte por byte
 * igual, que se comprobó volcándolo antes y después.
 */

/** Cómo tiene que SONAR una lección. */
export const LESSON_VOICE_RULES = `### Writing Voice & Quality Bar

How the lesson SOUNDS matters as much as what it covers. Write like an expert teacher explaining to one person — not like an encyclopedia.

- **Talk to the learner.** Use second person ("vas a calcular…", "fijate que…"), a clear, human rhythm, and the course locale's natural register — never a stiff literal translation from English.
- **Concrete beats abstract, always.** Every concept gets a real example, a real number, a worked case, or a mini scenario. Show, don't just define.
- **Open with a hook, not a dictionary.** Start each lesson by connecting to a real problem or goal the learner has, then teach. Don't open with "X is defined as…".
- **Cut filler.** No empty phrases ("es importante destacar que", "en el mundo actual", "como todos sabemos"). If a sentence doesn't teach something, delete it.
- **Produce, don't promise.** If you decide a diagram or example would help, MAKE IT — generate the full inline <svg> or the full worked example right there. NEVER write "se sugiere añadir un gráfico/ejemplo aquí" as a substitute for actually producing it. (The only allowed "suggested" callouts are for external media you literally cannot embed — uploaded video or raster images — as described below.)`;

/** Cuánto escribir: sin piso de palabras, y parar cuando falta material. */
export const LESSON_DEPTH_PRINCIPLES = `When implementing an approved course plan (i.e. you are filling out lessons end-to-end, not making a one-off edit), the goal is to **fully teach the topic** so a student could learn from the lesson alone — depth is a *consequence* of teaching it well, never a word count to hit.

**There is no minimum word count, and you must not treat length as a goal.** A lesson is finished when the material you actually have has been taught well — not when it reaches some size. A lesson that only defines the terms and states the formula has not taught anything; what fixes that is a worked example with real numbers, a second pass at the idea from a different angle, and the mistakes a student actually makes. What does NOT fix it is more words.

**If the sources do not carry enough material to teach the lesson properly, stop and say so.** Write what the material supports and tell the teacher plainly what is missing and what document would close the gap ("para 'Protocolos de seguridad' no tengo material: si me pasás el manual de higiene y seguridad la escribo"). A short honest lesson plus a clear request is a good outcome. Padding the gap with plausible-sounding general knowledge is the worst possible outcome — it is invisible to the teacher and wrong for the student.`;

/** La forma de una lección completa. */
export const LESSON_STRUCTURE_RULES = `- An <h3> introduction (1–2 short paragraphs) framing why the topic matters and what the student will be able to do after the lesson
- 3–6 sub-sections, each opened with an <h3> or <h4>, that walk through the concept step by step. Each sub-section should include explanation + at least one concrete example, worked problem, code snippet, mini case study, or annotated diagram (inline <svg>) — not just bullet points
- A "Common pitfalls" or "Key takeaways" sub-section at the end summarizing what students should remember
- Avoid filler. Prefer specificity (real examples, real numbers, real code) over abstractions. Do not pad word count with restatement
- If the topic is genuinely thin, prefer fewer but richer lessons over many shallow ones — say so to the teacher rather than producing skeletal content`;
