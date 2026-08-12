import * as z from 'zod';

/**
 * How generated lesson illustrations should look, per organization, stored under
 * `organization.settings.aiImages` (no dedicated column — same arrangement as
 * `atRisk`; see schema.ts).
 *
 * Two levers, because they answer different questions:
 *
 *  - `styleReferenceUrl` is an actual picture, passed to the model as a
 *    reference on every generation. It is the only thing that reliably holds a
 *    look together — there is no seed for these models, so a reference image is
 *    the mechanism. Measured: the same subject generated with and without one
 *    came out in the same warm palette versus a cold grey.
 *  - `styleNote` is words, appended to the house style. Weaker on its own, but
 *    it is what an organisation reaches for before it has an anchor image, and
 *    it can say things a picture cannot ("never show faces", "our brand blue").
 *
 * Both optional, and neither ever blocks a generation: with nothing set, images
 * come out in the house style. Keeping the style is desirable, not mandatory.
 */
export const DEFAULT_AI_IMAGE_SETTINGS = {
  styleReferenceUrl: null,
  styleNote: ''
} as const;

export const ZAiImageSettings = z.object({
  /**
   * Must be a public, permanent URL — it is fetched server-side at generation
   * time. A presigned or private URL would expire and silently stop shaping the
   * output. `null` clears the anchor.
   */
  styleReferenceUrl: z.string().url().max(2048).nullable(),
  /** Kept short on purpose: this rides in every image prompt. */
  styleNote: z.string().max(400)
});

export type TAiImageSettings = z.infer<typeof ZAiImageSettings>;

/** Partial — used for the org-level PUT (merge patch). */
export const ZAiImageSettingsUpdate = ZAiImageSettings.partial();
export type TAiImageSettingsUpdate = z.infer<typeof ZAiImageSettingsUpdate>;

/**
 * A style preview: one generated image, so an admin can see what their style
 * note and anchor actually produce before every lesson in a course inherits it.
 * The subject is fixed server-side — this is about the look, not the content.
 */
export const ZAiImagePreview = z.object({
  styleNote: z.string().max(400).optional(),
  styleReferenceUrl: z.string().url().max(2048).nullable().optional()
});

export type TAiImagePreview = z.infer<typeof ZAiImagePreview>;
