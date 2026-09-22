import { EXERCISE_QUALITY_RULES } from './exercise-rules';

/**
 * El prompt del sub-agente que escribe las preguntas de UN ejercicio.
 *
 * ── Por qué existe ───────────────────────────────────────────────────────────
 *
 * Las preguntas las escribía el mismo agente que construye el curso, y durante
 * una construcción ese agente NO vio el texto de ninguna lección: las escribe
 * `write_lesson` con contexto limpio y a él le vuelven unos cientos de
 * caracteres. El control que había —«leíste estas lecciones en esta ronda»—
 * comprobaba el PROCESO, no el resultado: medido el 2026-09-21, 4 de 8
 * preguntas de una autoevaluación no salían de la lección que decían evaluar,
 * con la lectura hecha.
 *
 * Acá las escribe quien SÍ tiene el texto delante, y nada más que el texto: sin
 * el plan, sin las fuentes, sin la conversación. Lo único que puede preguntar
 * es lo que las lecciones dicen.
 *
 * ── Por qué cada pregunta trae su evidencia ──────────────────────────────────
 *
 * Porque es lo que el servidor puede verificar. La frase copiada textual de la
 * lección se busca en el texto de las lecciones del ejercicio: si no aparece,
 * la pregunta se descarta. Una pregunta inventada puede sonar perfecta; su
 * evidencia, no — o está en la lección o no está.
 *
 * ── Por qué la numérica pide un campo propio ─────────────────────────────────
 *
 * La respuesta de una pregunta numérica vive en `settings.correctValue`, y
 * `settings` es un mapa libre: el esquema no le pide nada concreto ahí y el
 * escritor lo dejaba vacío. Medido el 2026-09-22: 5 numéricas escritas, 5
 * descartadas al validarlas, todas con su evidencia impecable. Ahora la pide
 * como `numericAnswer`, un campo con nombre y tipo, y el servidor la vuelca a
 * `settings` antes de validar.
 *
 * ── Por qué recibe la lista de tipos ─────────────────────────────────────────
 *
 * Los tipos premium dependen del plan de la organización, así que el bloque se
 * arma afuera (`buildQuestionTypeListBlock`) y entra como parámetro. Es lo
 * único que cambia de una organización a otra: el resto del texto es igual para
 * todos los cursos, y así la caché del proveedor lo sirve desde la segunda
 * llamada.
 */
export function buildQuestionWriterPrompt(questionTypeListBlock: string): string {
  return `You write the questions of ONE exercise of an online course. Another agent is building the course and handed this exercise to you. You work with a clean context: the title of the exercise, a short brief, and the FULL TEXT of the lessons this exercise covers.

## The only material you have is the lessons

Everything you ask must be answerable by someone who read those lessons and nothing else. You do not know the course's sources, its other lessons, or the organisation behind it. If the lessons do not teach something, it is not on this exam — no general knowledge, no "obviously true" facts, no topic you would expect a course like this to cover.

If the lessons do not carry enough material for the number of questions you were asked for, write fewer and say so in \`note\`. A short exercise whose every question is answerable beats a long one with questions nobody can answer.

## Every question carries its evidence

Each question has an \`evidence\` field: the sentence of the lesson that the question tests, copied VERBATIM from the lesson text above — same words, same order, at least a dozen characters. Not a summary, not a paraphrase, not your own wording of it.

The server looks for that sentence in the lessons. **A question whose evidence is not found is discarded** and never reaches the course, so copying the sentence is not paperwork: it is what decides whether your question exists. Write the question FROM a sentence you can point at; do not write the question first and then go looking for something to justify it.

## Question Types

These are the only question type IDs supported by this platform. Always use these IDs:

${questionTypeListBlock}

- NUMERIC: the correct answer goes in \`numericAnswer\` as a number (add \`numericTolerance\` unless the answer is exact), and the question takes NO options. **A NUMERIC question without \`numericAnswer\` is discarded** — it would award zero points to every learner, so the server refuses it. Only use this type when the lessons let the learner compute or recall an exact number.
- STAR: \`settings.correctValue\`. WORD_BANK: \`settings.correctAnswers\` and \`settings.template\`.
- TRUE_FALSE: exactly two options, labelled with the words for true and false IN THE COURSE LANGUAGE ("Verdadero" / "Falso" in Spanish, "True" / "False" in English), exactly one marked correct.
- RADIO / CHECKBOX: the options carry the answer (\`isCorrect\`), and the question takes no \`settings\`. RADIO needs at least two options with exactly one marked correct; CHECKBOX needs at least two with at least one marked correct.
- **A RADIO, CHECKBOX or TRUE_FALSE question that comes back without options is discarded** — the learner would have nothing to choose from, so the server refuses it, exactly as it does with a NUMERIC that has no \`numericAnswer\`. Every question of those three types carries its \`options\` array, filled.

Write the questions, the options and everything a learner reads in the course language you are given — the same language the lessons are written in.

${EXERCISE_QUALITY_RULES}

## What you return

- \`questions\`: the questions, in the order a learner should see them, each with its \`evidence\`.
- \`note\`: optional, one to three plain sentences in the course language, for the teacher — what the lessons did not let you cover, or why you wrote fewer questions than asked. The agent that called you relays it. Leave it out when there is nothing to say.`;
}
