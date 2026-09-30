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

/**
 * Cómo tiene que SONAR una lección.
 *
 * Las dos últimas reglas son de 2026-09-29, y las dos salen de un curso para
 * vendedores: la lección decía «1,048,576 filas» —copiado de la fuente, y en
 * Argentina eso se lee como un decimal— y le recomendaba a un principiante «un
 * gris suave (#e2e8f0)», que es el gris de la paleta de los diagramas. Van acá
 * y no sólo en el escritor porque el constructor también escribe lecciones.
 */
export const LESSON_VOICE_RULES = `### Writing Voice & Quality Bar

How the lesson SOUNDS matters as much as what it covers. Write like an expert teacher explaining to one person — not like an encyclopedia.

- **Talk to the learner.** Use second person ("vas a calcular…", "fijate que…"), a clear, human rhythm, and the course locale's natural register — never a stiff literal translation from English.
- **Concrete beats abstract, always.** Every concept gets a real example, a real number, a worked case, or a mini scenario. Show, don't just define.
- **Open with a hook, not a dictionary.** Start each lesson by connecting to a real problem or goal the learner has, then teach. Don't open with "X is defined as…".
- **Cut filler.** No empty phrases ("es importante destacar que", "en el mundo actual", "como todos sabemos"). If a sentence doesn't teach something, delete it.
- **Produce, don't promise.** If you decide a diagram or example would help, MAKE IT — generate the full inline <svg> or the full worked example right there. NEVER write "se sugiere añadir un gráfico/ejemplo aquí" as a substitute for actually producing it. (The only allowed "suggested" callouts are for external media you literally cannot embed — uploaded video or raster images — as described below.)
- **Numbers the way the course language writes them.** In Spanish, thousands with a dot and decimals with a comma: 1.048.576 filas, 16.384 columnas, 3,5 %, $ 1.200,50. In English, 1,048,576 and 3.5. A source written in another convention keeps its value, not its format: never copy "1,048,576" into a Spanish lesson, where it reads as a decimal.
- **No internal values in the text.** Colour codes (#e2e8f0), CSS names and the diagram palette belong inside your SVG attributes only. In the lesson, name a colour the way the learner will find it — "un gris claro de la paleta de relleno" — never by its code.`;

/**
 * Cuándo va una tabla, y cómo.
 *
 * Desde el 2026-09-29 el escritor puede escribir una tabla simple: prohibida,
 * la única forma que le quedaba de mostrar una planilla era una lista con «|»,
 * lo contrario de lo que enseña una lección de planillas. Vive acá y no sólo en
 * el escritor porque el constructor también escribe y reemplaza bloques: con
 * el «Do NOT use: <table>» viejo en su prompt, el bloque de una tabla que dejó
 * el escritor quedaba trabado entre esa regla y la de `replace_lesson_block`,
 * que exige conservar las tablas del bloque.
 */
export const LESSON_TABLE_RULE = `Data that IS a table — the rows and columns of a spreadsheet, values compared side by side — goes in a simple <table>: a <thead> with one <tr> of <th>, a <tbody> with one <tr> per row and one <td> per value, plain text inside the cells, no nested tables, no merged cells. Never fake a table with a list whose items join the values with "|", and never draw a spreadsheet in an SVG with a whole row inside one box.`;

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
