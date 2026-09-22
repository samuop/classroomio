export const FORBID_TAGS = [
  'script',
  'iframe',
  'object',
  'embed',
  'form',
  'input',
  'textarea',
  'select',
  'button',
  'meta',
  'link',
  'foreignObject',
  'math'
] as const;

export const FORBID_ATTR = [
  'onerror',
  'onload',
  'onclick',
  'onmouseover',
  'onfocus',
  'onblur',
  'onchange',
  'onsubmit',
  'onreset',
  'onselect',
  'onunload'
] as const;

/**
 * `ALLOW_DATA_ATTR` is false, so every data attribute that must survive is
 * listed here explicitly.
 *
 * `data-cio-media*` mark where in a note one of the lesson's own media items
 * should appear. They are inert — the viewer reads them and renders the real
 * player itself — which is what lets iframes stay forbidden while still
 * allowing a teacher to place a video mid-paragraph.
 *
 * `data-block-id` gives each top-level block a stable name, so the agent can
 * replace one by id instead of reproducing its old text character for character.
 *
 * `data-sin-fuente` marks a passage the writer could not ground in the source,
 * carrying what is missing. It has to survive sanitising for the same reason it
 * exists: the mark is the only difference between a paragraph that came out of
 * a document and one the model supplied itself, and a stripped mark turns the
 * second into the first silently.
 *
 * `data-ejemplo` marks a worked example the writer made up on purpose — the
 * names, numbers and error codes in it come from nowhere and nobody should go
 * looking for them. The server checks unmarked names and numbers against the
 * sources and hands them back as a gate, so a stripped mark would turn a
 * declared example back into an unexplained invention on the next check.
 */
export const ADD_ATTR = [
  'data-type',
  'data-latex',
  'colwidth',
  'data-cio-media',
  'data-cio-media-id',
  'data-block-id',
  'data-sin-fuente',
  'data-ejemplo'
] as const;

export const ALLOWED_URI_REGEXP =
  /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i;

export function createSanitizeHtmlConfig() {
  return {
    FORBID_TAGS: [...FORBID_TAGS],
    FORBID_ATTR: [...FORBID_ATTR],
    ADD_ATTR: [...ADD_ATTR],
    KEEP_CONTENT: true,
    SANITIZE_DOM: true,
    ALLOW_DATA_ATTR: false,
    ALLOWED_URI_REGEXP
  };
}

export function stripSvgDataUrls(html: string): string {
  return html.replace(/src\s*=\s*["']data:image\/svg[^"']*["']/gi, 'src=""');
}
