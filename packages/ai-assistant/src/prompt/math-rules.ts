/**
 * The rules for writing a formula in a lesson, in one place.
 *
 * Lesson math renders through KaTeX, which only visits nodes shaped like
 * `<span data-type="inline-math" data-latex="…">` — see `renderMathInElement`
 * in @cio/ui, and ADD_ATTR in the sanitizer, which whitelists both attributes.
 * Anything else reaches the learner as literal source.
 *
 * Every rule here was written against a defect seen in a real generated lesson:
 * `$\sigma_0^2$` printed with its dollar signs, a formula parked in a <code>
 * block, and LaTeX inside an SVG <text> where KaTeX can never reach it. The
 * checks in `validateLessonMath` (API) mirror them, and
 * `normalizeAgentLessonContent` repairs the first case outright.
 */
export const MATH_FORMULA_RULES = `- **Never write \`$…$\`, \`$$…$$\`, \`\\(…\\)\` or \`\\[…\\]\`.** Those are markdown conventions; lesson content is HTML, so they reach the learner as literal dollar signs and backslashes. There is exactly one way to write a formula:
  - Inline, inside a sentence: \`<span data-type="inline-math" data-latex="\\sigma_0^2"></span>\`
  - Standalone, on its own line: \`<span data-type="block-math" data-latex="\\chi^2 = \\frac{(n-1)S^2}{\\sigma_0^2}"></span>\`
  - The LaTeX goes in the \`data-latex\` attribute and the element stays EMPTY. Escape \`"\` as \`&quot;\` inside the attribute.
- **Never put a formula in a \`<code>\` or \`<pre>\` block.** Those are for code. A formula there renders in monospace with the LaTeX showing, which is the defect, not the fix.
- **Never put LaTeX inside an \`<svg>\`.** KaTeX only walks HTML, and SVG \`<text>\` is not HTML — it is never visited, so the LaTeX shows as raw source AND overflows the box you sized for the rendered formula. Inside a diagram, write the symbols directly as Unicode: χ² σ₀² σ² α β μ ρ Σ √ ∫ ≤ ≥ ≠ ± ∞ → ×. Keep diagram labels to a short symbol or a plain word; put the real formula in a block-math span above or below the diagram.
- **Prefer Unicode for a lone symbol in running prose.** "el valor de α" reads better and costs less than a math span around a single Greek letter. Reserve the math spans for actual expressions — anything with a fraction, exponent, subscript, root, sum or relation.`;
