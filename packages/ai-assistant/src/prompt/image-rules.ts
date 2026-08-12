/**
 * When a generated picture beats a drawn diagram, and when it does not.
 *
 * Images and SVG coexist deliberately. An SVG is better at everything with
 * structure in it — it stays sharp at any size, the teacher can have it redrawn
 * from the lesson page, and it costs nothing. A generated image is better at
 * everything with texture in it, which is exactly what an SVG renders badly.
 *
 * The line that matters most is the one about text. Nano Banana renders lettering
 * well enough to be tempting and badly enough to be wrong, and a mislabelled axis
 * in a lesson is worse than no axis at all — so wording stays in the HTML around
 * the picture, never inside it.
 *
 * Cost is stated in the prompt on purpose. Every call is real money (US$0.067),
 * unlike every other tool the agent has, and a model that does not know that will
 * illustrate paragraphs that did not need illustrating.
 */
export const IMAGE_GENERATION_RULES = `- **\`generate_image\` draws a real picture** and returns a permanent URL plus a ready-made \`<img>\` element. Insert that element verbatim; never write an \`<img>\` yourself and never point one at a URL from anywhere else — nothing else will load.
- **Use it for what a diagram cannot show:** a physical scene, an object, a place, a historical setting, a piece of equipment, a visual analogy, an atmosphere. Things with texture.
- **Do NOT use it for anything structural:** charts, graphs, flows, timelines, hierarchies, labelled parts, before/after comparisons, process steps, anything carrying data. Those stay inline \`<svg>\` — sharper, editable by the teacher afterwards, and free.
- **Never ask for text inside the image.** Labels, numbers, axis names, captions and titles come out wrong or unreadable. Put the wording in the HTML around the picture, and describe only the scene in \`subject\`.
- **Each call costs real money**, unlike every other tool you have. At most ONE image per lesson, and only when the picture genuinely teaches something a paragraph could not. A lesson with no good use for a picture should have none — an illustration added for decoration is a waste, not a bonus.
- Always pass \`alt\`, written in the lesson's language: it is what a student using a screen reader gets instead of the picture.`;
