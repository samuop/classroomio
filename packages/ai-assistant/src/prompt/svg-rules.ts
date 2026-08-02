/**
 * The rules for writing a lesson diagram, in one place.
 *
 * Two callers need them and they must not drift apart: the course builder, which
 * writes diagrams as part of a lesson, and the single-diagram regenerator behind
 * the "improve this diagram" control in the lesson view. When these lived only
 * inside the teacher prompt, fixing a rule in one path silently left the other
 * producing the defect it was meant to stop.
 *
 * Every rule here was written against a defect seen in a real generated lesson,
 * not imagined — see `validateSvgDiagram` in the API, whose checks mirror them.
 */
export const SVG_DIAGRAM_RULES = `- **Sizing (the #1 cause of broken diagrams):** each <svg> renders inside a fixed-size sandboxed box whose height comes from your root \`height\` attribute. **If your content is taller than that height, it gets CLIPPED.** So: set \`viewBox="0 0 W H"\` and make the root \`width="W"\` and \`height="H"\` match that same aspect ratio, and make sure EVERY element (shapes AND text) sits fully inside \`0..W\` × \`0..H\` with ~10px padding from every edge. Never let a label run past the right edge or below the bottom. Recommended canvas: 640–800 wide; height whatever the content needs (don't cram — grow the height instead of overlapping).
- **Text must fit and not overlap:** minimum \`font-size="14"\` (never below 12). Keep labels short. Leave clear vertical space between rows/nodes (≥40px). Do not stack two text elements at nearly the same y. If a label is long, split it across two <text> lines rather than letting it overflow its box.
- **Paint order: ALL shapes first, THEN all text.** SVG paints in document order, so any <rect>/<circle>/<ellipse> written after a <text> covers it. This is what silently truncates labels in Venn diagrams — the intersection ellipse drawn last swallows the set names on either side of it. Emit every filled shape, then every label.
- **Give the caption its own band.** A closing sentence under the figure must sit BELOW everything else, in vertical space nobody else uses: grow the canvas height by ~30px and put the caption there. A caption placed at the same height as the axis labels runs straight through them — a full-width sentence crosses every tick label on the axis, even though each one is in a different column.
- **When a value maps to a position, keep the scale linear.** On an axis, the pixel distance between 0 and 2 must equal the distance between 6 and 8. Compute each x as \`left + (value - min) / (max - min) * plotWidth\` rather than eyeballing it, and put tick labels below the axis line, never inside the plot area.
- **Legibility:** dark text (#1e293b) on light fills; a small readable palette (e.g. #3b82f6 blue, #10b981 green, #f59e0b amber, #ef4444 red, #e2e8f0 light-grey boxes) with #334155 strokes. The box always has a near-white background, so avoid white/very-light text.
- **Structure:** self-contained (no external refs, no <style>, no CSS classes — use presentation attributes like \`fill=\` / \`stroke=\` directly). Do NOT use <foreignObject>. Place each <svg> as its own top-level block, never inside a <p>.
- **Worked example** (a clean 3-step process — copy this shape, adapt the content):
  \`<svg viewBox="0 0 640 140" width="640" height="140" xmlns="http://www.w3.org/2000/svg"><rect x="20" y="45" width="160" height="50" rx="8" fill="#e2e8f0" stroke="#334155"/><text x="100" y="75" font-size="15" text-anchor="middle" fill="#1e293b">1. Recolectar</text><line x1="180" y1="70" x2="240" y2="70" stroke="#334155" stroke-width="2" marker-end="url(#a)"/><rect x="240" y="45" width="160" height="50" rx="8" fill="#dbeafe" stroke="#334155"/><text x="320" y="75" font-size="15" text-anchor="middle" fill="#1e293b">2. Procesar</text><line x1="400" y1="70" x2="460" y2="70" stroke="#334155" stroke-width="2" marker-end="url(#a)"/><rect x="460" y="45" width="160" height="50" rx="8" fill="#d1fae5" stroke="#334155"/><text x="540" y="75" font-size="15" text-anchor="middle" fill="#1e293b">3. Publicar</text><defs><marker id="a" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#334155"/></marker></defs></svg>\``;
