// SaaS default CSP domains, baked in at build time.
// Self-hosted (adapter-node) starts with empty lists; runtime domains
// are added via env vars in hooks.server.ts so pre-built Docker images stay configurable.

/**
 * Origins every deployment needs, self-hosted included.
 *
 * Google Fonts is not a third-party integration an operator opts into here: the
 * certificate renderer hard-codes `FONTS_LINK_HREF` at fonts.googleapis.com
 * (packages/certificates), and the lesson editor loads display faces the same
 * way. Self-hosted builds started from empty lists, so the stylesheet was
 * blocked outright and every one of those faces silently fell back to a system
 * font — while the exported PDF, rendered by Cloudflare's browser under no
 * policy of ours, used the real ones. The preview and the issued document
 * disagreed, which is the one thing the certificate design refuses to allow.
 */
const requiredEverywhere = {
  styleSrc: ['https://fonts.googleapis.com'],
  fontSrc: ['https://fonts.gstatic.com']
};

const saasDefaults = {
  scriptSrc: [
    'https://assets.cdn.clsrio.com',
    'https://cdnjs.cloudflare.com',
    'https://*.posthog.com',
    'https://umami.hz.oncws.com',
    'https://www.youtube.com',
    'https://youtube.com',
    'https://google.com',
    'https://apis.google.com',
    'https://accounts.google.com'
  ],
  styleSrc: [
    'https://cdn.plyr.io',
    'https://unpkg.com/katex@0.12.0/dist/katex.min.css',
    'https://assets.cdn.clsrio.com/eqneditor_1.css',
    'https://fonts.googleapis.com'
  ],
  connectSrc: [
    'https://*.classroomio.com',
    'https://classroomio.com',
    'https://app.classroomio.com',
    'https://api.classroomio.com',
    'https://pgrest.classroomio.com',
    'https://play.classroomio.com',
    'wss://*.classroomio.com',
    'https://assets.cdn.clsrio.com',
    'https://cdn.plyr.io',
    'https://*.posthog.com',
    'https://umami.hz.oncws.com',
    'https://*.r2.cloudflarestorage.com',
    'https://*.ytimg.com',
    'https://noembed.com',
    'https://www.googleapis.com'
  ],
  frameSrc: [
    'https://www.youtube.com',
    'https://youtube.com',
    'https://www.youtube-nocookie.com',
    'https://www.google.com',
    'https://google.com',
    'https://drive.google.com',
    'https://docs.google.com'
  ],
  fontSrc: ['https://fonts.gstatic.com', 'https://cdn.plyr.io'],
  mediaSrc: ['https:']
};

/**
 * Normalizes a media/storage host into an origin usable in a CSP source list.
 * Accepts either a bare host (`learn-files.tensor.com.ar`) or a full URL and
 * returns `https://host`. Empty/undefined → null.
 * @param {string | undefined} host
 * @returns {string | null}
 */
function normalizeMediaHost(host) {
  const value = host?.trim();
  if (!value) return null;
  if (value.startsWith('http://') || value.startsWith('https://')) return value;
  return `https://${value}`;
}

/**
 * @param {boolean} isSelfHosted
 * @param {string | undefined} serverUrl - PUBLIC_SERVER_URL, added to connect-src for SaaS builds
 * @param {string | undefined} mediaHost - PUBLIC_MEDIA_HOST, the object-storage origin (e.g.
 *   `learn-files.tensor.com.ar`). Baked into img-src/media-src/connect-src at build time so
 *   uploaded images/videos aren't blocked by CSP when served from a separate storage domain.
 */
export function getCspDomains(isSelfHosted, serverUrl, mediaHost) {
  const mediaOrigin = normalizeMediaHost(mediaHost);
  const media = mediaOrigin ? [mediaOrigin] : [];

  if (isSelfHosted) {
    return {
      scriptSrc: [],
      styleSrc: [...requiredEverywhere.styleSrc],
      connectSrc: media,
      frameSrc: [],
      fontSrc: [...requiredEverywhere.fontSrc],
      mediaSrc: media,
      apiOrigin: null
    };
  }

  return {
    ...saasDefaults,
    styleSrc: [...new Set([...saasDefaults.styleSrc, ...requiredEverywhere.styleSrc])],
    fontSrc: [...new Set([...saasDefaults.fontSrc, ...requiredEverywhere.fontSrc])],
    connectSrc: [...saasDefaults.connectSrc, ...media],
    mediaSrc: [...saasDefaults.mediaSrc, ...media],
    apiOrigin: serverUrl ?? null
  };
}
