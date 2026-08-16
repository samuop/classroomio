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
 *
 * But cost was ALL these rules used to say. Three separate discouragements ("at
 * most one", "should have none", "a waste, not a bonus") and no statement of when
 * a picture is wanted, which produced courses with zero images — the same shape
 * of failure as the thin-lesson bug, where the one concrete number in the prompt
 * pushed the wrong way. The ceiling stays; what is new is that the floor is
 * stated too, and that the "when" covers abstract subjects. A course on selling
 * has no equipment and no historical settings, so a list that leads with physical
 * objects reads to the model as "never".
 */
export const IMAGE_GENERATION_RULES = `- **\`generate_image\` draws a real picture** and returns a permanent URL plus a ready-made \`<img>\` element. Insert that element verbatim; never write an \`<img>\` yourself and never point one at a URL from anywhere else — nothing else will load.
- **Use it for what a diagram cannot show:** anything with texture rather than geometry. A physical scene, an object, a place, a historical setting, a piece of equipment — but just as much a **human situation** (two people mid-negotiation, a shop counter, a first meeting), a **visual metaphor** for an abstract idea, or the **mood** of a moment. Subjects with no physical objects in them at all — selling, leadership, communication, ethics — are not exempt: their pictures are scenes and metaphors, and those are exactly what prose struggles to convey.
- **Do NOT use it for anything structural:** charts, graphs, flows, timelines, hierarchies, labelled parts, before/after comparisons, process steps, anything carrying data. Those stay inline \`<svg>\` — sharper, editable by the teacher afterwards, and free.
- **Never ask for text inside the image.** Labels, numbers, axis names, captions and titles come out wrong or unreadable. Put the wording in the HTML around the picture, and describe only the scene in \`subject\`.
- **Each call costs real money**, unlike every other tool you have — so at most ONE image per lesson, and never one added purely for decoration.
- **That ceiling is not a target of zero.** A lesson of unbroken prose is a failure of this job. Every lesson needs at least one visual; a diagram satisfies that and costs nothing, so reach for \`<svg>\` first. Spend an image when the thing worth showing is a scene or a feeling that no diagram can carry.
- Always pass \`alt\`, written in the lesson's language: it is what a student using a screen reader gets instead of the picture.`;
