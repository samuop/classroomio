/**
 * The contract between the settings screen and the generator.
 *
 * Both sides parse with this schema — the dashboard before sending, the route
 * before storing — so what it accepts is the whole agreement about what an
 * organisation's image style can be.
 */
import { describe, expect, it } from 'vitest';

import { DEFAULT_AI_IMAGE_SETTINGS, ZAiImageSettings, ZAiImageSettingsUpdate } from '@cio/utils/validation';

describe('ZAiImageSettings', () => {
  it('accepts a configured style', () => {
    const parsed = ZAiImageSettings.safeParse({
      styleReferenceUrl: 'https://learn-files.tensor.com.ar/media/anchor.jpg',
      styleNote: 'Ilustración plana, sin rostros reconocibles.'
    });

    expect(parsed.success).toBe(true);
  });

  it('lets null clear the anchor — that is how you go back to no reference', () => {
    expect(ZAiImageSettings.safeParse({ styleReferenceUrl: null, styleNote: '' }).success).toBe(true);
  });

  it('rejects a reference that is not a URL', () => {
    // The generator fetches this server-side; a relative path or a filename
    // would fail there, after the admin thought they had configured a style.
    expect(ZAiImageSettings.safeParse({ styleReferenceUrl: '/media/anchor.jpg', styleNote: '' }).success).toBe(false);
  });

  it('caps the note, because it rides in every image prompt', () => {
    const tooLong = { styleReferenceUrl: null, styleNote: 'a'.repeat(401) };

    expect(ZAiImageSettings.safeParse(tooLong).success).toBe(false);
  });

  it('takes a patch with only one field, for the merge PUT', () => {
    expect(ZAiImageSettingsUpdate.safeParse({ styleNote: 'solo la nota' }).success).toBe(true);
    expect(ZAiImageSettingsUpdate.safeParse({}).success).toBe(true);
  });

  it('has defaults that mean "no style configured"', () => {
    expect(ZAiImageSettings.safeParse(DEFAULT_AI_IMAGE_SETTINGS).success).toBe(true);
    expect(DEFAULT_AI_IMAGE_SETTINGS.styleReferenceUrl).toBeNull();
    expect(DEFAULT_AI_IMAGE_SETTINGS.styleNote).toBe('');
  });
});
