/**
 * Which origins the Content Security Policy lets through.
 *
 * This file exists because the self-hosted build shipped with empty style and
 * font lists, which blocked fonts.googleapis.com outright. The certificate
 * renderer hard-codes that stylesheet, so every display face silently fell back
 * to a system font in the app — while the exported PDF, rendered by
 * Cloudflare's browser under no policy of ours, used the real ones. Nothing
 * failed loudly; the preview and the issued document just quietly disagreed.
 */
import { getCspDomains } from './csp-domains.js';

describe('getCspDomains', () => {
  const selfHosted = () => getCspDomains(true, undefined, 'learn-files.tensor.com.ar');
  const saas = () => getCspDomains(false, 'https://api.classroomio.com', undefined);

  it('lets a self-hosted build load the fonts the product itself requests', () => {
    expect(selfHosted().styleSrc).toContain('https://fonts.googleapis.com');
    expect(selfHosted().fontSrc).toContain('https://fonts.gstatic.com');
  });

  it('lets the SaaS build load them too', () => {
    expect(saas().styleSrc).toContain('https://fonts.googleapis.com');
    expect(saas().fontSrc).toContain('https://fonts.gstatic.com');
  });

  it('does not list an origin twice', () => {
    // A duplicate is harmless to browsers and a smell in review; more to the
    // point, it means the merge is appending blindly.
    const { styleSrc, fontSrc } = saas();

    expect(new Set(styleSrc).size).toBe(styleSrc.length);
    expect(new Set(fontSrc).size).toBe(fontSrc.length);
  });

  it('keeps self-hosted builds free of the SaaS third parties', () => {
    // The point of the self-hosted variant: no analytics, no CDNs an operator
    // did not ask for. Fonts are the exception because the product breaks
    // visibly without them.
    const { scriptSrc, connectSrc, frameSrc } = selfHosted();

    expect(scriptSrc).toEqual([]);
    expect(frameSrc).toEqual([]);
    expect(connectSrc.some((origin) => origin.includes('posthog'))).toBe(false);
  });

  it('carries the storage host into the origins that serve uploads', () => {
    const { mediaSrc, connectSrc } = selfHosted();

    expect(mediaSrc).toContain('https://learn-files.tensor.com.ar');
    expect(connectSrc).toContain('https://learn-files.tensor.com.ar');
  });

  it('accepts a storage host given as a bare hostname or a full URL', () => {
    expect(getCspDomains(true, undefined, 'https://files.example.com').mediaSrc).toContain(
      'https://files.example.com'
    );
    expect(getCspDomains(true, undefined, 'files.example.com').mediaSrc).toContain('https://files.example.com');
  });

  it('omits the storage origin entirely when none is configured', () => {
    expect(getCspDomains(true, undefined, undefined).mediaSrc).toEqual([]);
  });
});
