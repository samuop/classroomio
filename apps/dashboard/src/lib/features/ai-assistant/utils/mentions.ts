type MentionType = 'lesson' | 'exercise' | 'section' | 'landingpage';

/** The mention types that point at a row of the course, and so can point at the wrong one. */
export type ContentMentionType = Exclude<MentionType, 'landingpage'>;

/** A navigable item of the course, as the chat currently knows it. */
export interface MentionTarget {
  id: string;
  title: string;
  type: ContentMentionType;
}

/** What the agent wrote: `@[title](type:id)`. */
export interface MentionRef {
  type: ContentMentionType;
  id: string;
  title: string;
}

/**
 * - `ok`: the id is a real item of that type.
 * - `repaired`: the id was wrong, but the title (or the id's real type) names
 *   exactly one item — the link goes there instead.
 * - `unknown`: nothing in the course matches. Either the agent invented the id
 *   AND the title, or the item is so new the chat has not loaded it yet; the
 *   two cannot be told apart here, so the click decides (see `ai-course-chat`).
 */
export type MentionResolution = { status: 'ok' | 'repaired' | 'unknown'; type: ContentMentionType; id: string };

/**
 * Mention format: @[Title](type:id)
 * Where type is "lesson", "exercise", or "section" and id is the content item ID.
 * Landing page: @[Title](landingpage) or @[Title](landingpage:COURSE_ID) — resolves to this course's landing page editor.
 */
const RAW_MENTION_REGEX = /@\[([^\]]+)\]\((lesson|exercise|section):([a-zA-Z0-9_-]+)\)/gi;
const RAW_LANDINGPAGE_MENTION_REGEX = /@\[([^\]]+)\]\(landingpage(?::[a-zA-Z0-9_-]+)?\)/gi;
const HTML_LINK_MENTION_REGEX = /@?<a\b[^>]*href=(["'])(lesson|exercise|section):([a-zA-Z0-9_-]+)\1[^>]*>(.*?)<\/a>/gi;
const HTML_LINK_LANDINGPAGE_MENTION_REGEX = /@?<a\b[^>]*href=(["'])landingpage(?::[a-zA-Z0-9_-]+)?\1[^>]*>(.*?)<\/a>/gi;

function normalizeMentionType(type: string): MentionType | null {
  const normalizedType = type.toLowerCase();

  if (
    normalizedType === 'lesson' ||
    normalizedType === 'exercise' ||
    normalizedType === 'section' ||
    normalizedType === 'landingpage'
  ) {
    return normalizedType;
  }

  return null;
}

function getLandingPageEditorRoute(courseId: string): string {
  return `/courses/${courseId}/landingpage`;
}

export function getMentionRoute(courseId: string, type: MentionType, id: string) {
  if (type === 'landingpage') return getLandingPageEditorRoute(courseId);
  if (type === 'exercise') return `/courses/${courseId}/exercises/${id}`;
  if (type === 'section') return `/courses/${courseId}/lessons#section-${id}`;

  return `/courses/${courseId}/lessons/${id}`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** Visible text of a markdown-rendered anchor label, for matching against titles. */
function labelText(label: string): string {
  return label
    .replace(/<[^>]+>/g, '')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

/**
 * Comparable form of a title: no accents, no case, no punctuation.
 *
 * Tolerant only of what carries no meaning. "Cómo está organizada la empresa"
 * and "como esta organizada la Empresa." are the same lesson; "Organigrama" and
 * "Organigrama 2023" are not — no partial matches, because a partial match is
 * exactly how a repair would send the teacher to the wrong lesson.
 */
function normalizeTitle(title: string): string {
  return title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Where a mention the agent wrote actually points.
 *
 * The agent copies ids out of tool results into prose, and a model can emit an
 * id that never existed: measured in dev, a build summary linked a lesson as
 * `798ca7a5-…` while the tool had returned `585f735a-…` — a fabricated UUID,
 * not a mistyped one. The prompt already forbids this; the rule alone is not
 * enough, so the link is checked against the course instead of trusted.
 *
 * Order matters. The title within the requested type is tried before the id's
 * real type: `@[Organigrama](lesson:<a section id>)` means the lesson called
 * Organigrama, not the section the stray id happens to belong to.
 */
export function resolveMention(ref: MentionRef, targets: MentionTarget[] | undefined): MentionResolution {
  // Nothing to check against (course not loaded yet): behave exactly as before.
  if (!targets || targets.length === 0) return { status: 'ok', type: ref.type, id: ref.id };

  const byId = targets.find((target) => target.id === ref.id);

  if (byId && byId.type === ref.type) return { status: 'ok', type: ref.type, id: ref.id };

  const title = normalizeTitle(ref.title);
  const byTitle = title
    ? targets.filter((target) => target.type === ref.type && normalizeTitle(target.title) === title)
    : [];

  // Two items with the same title is a guess either way; refusing to guess is
  // what keeps a repair from being worse than the broken link.
  if (byTitle.length === 1) return { status: 'repaired', type: ref.type, id: byTitle[0].id };

  if (byId) return { status: 'repaired', type: byId.type, id: byId.id };

  return { status: 'unknown', type: ref.type, id: ref.id };
}

function buildMentionLink(route: string, label: string, title: string) {
  return `<a href="${route}" data-mention-route="${route}" class="mention-link" title="${escapeHtml(title)}">${label}</a>`;
}

/**
 * A link to a lesson, exercise or section, pointed wherever `resolveMention`
 * says. It also carries what the agent originally wrote, so a click can check
 * it again against a fresher course than the one this render saw.
 */
function buildContentMentionLink(
  courseId: string,
  ref: MentionRef,
  label: string,
  targets: MentionTarget[] | undefined
): string {
  const resolution = resolveMention(ref, targets);
  const route = getMentionRoute(courseId, resolution.type, resolution.id);

  const attributes = [
    `href="${route}"`,
    `data-mention-route="${route}"`,
    `data-mention-type="${resolution.type}"`,
    `data-mention-id="${escapeHtml(resolution.id)}"`,
    `data-mention-title="${escapeHtml(ref.title)}"`,
    ...(resolution.status === 'unknown' ? ['data-mention-unverified="true"'] : []),
    'class="mention-link"',
    `title="${escapeHtml(`${resolution.type}: ${ref.title}`)}"`
  ];

  return `<a ${attributes.join(' ')}>${label}</a>`;
}

/**
 * Replace AI lesson, exercise, section, and landing-page mentions with in-app links.
 * Handles both raw mention syntax and markdown-generated anchor tags.
 *
 * With `targets`, every content link is checked against the course and repaired
 * when its id is wrong (see `resolveMention`). Without them it renders the links
 * as written — the behaviour before the check existed.
 */
export function renderMentions(html: string, courseId: string, targets?: MentionTarget[]): string {
  const landingHtmlRoutes = html.replace(
    HTML_LINK_LANDINGPAGE_MENTION_REGEX,
    (match, _quote: string, label: string) => {
      const route = getLandingPageEditorRoute(courseId);
      return buildMentionLink(route, label, 'landingpage');
    }
  );

  const linksWithRoutes = landingHtmlRoutes.replace(
    HTML_LINK_MENTION_REGEX,
    (match, _quote: string, type: string, id: string, label: string) => {
      const mentionType = normalizeMentionType(type);

      if (!mentionType || mentionType === 'landingpage') return match;

      return buildContentMentionLink(courseId, { type: mentionType, id, title: labelText(label) }, label, targets);
    }
  );

  const withLandingRaw = linksWithRoutes.replace(RAW_LANDINGPAGE_MENTION_REGEX, (match, title: string) => {
    const route = getLandingPageEditorRoute(courseId);
    return buildMentionLink(route, escapeHtml(title), `landingpage: ${title}`);
  });

  return withLandingRaw.replace(RAW_MENTION_REGEX, (match, title: string, type: string, id: string) => {
    const mentionType = normalizeMentionType(type);

    if (!mentionType || mentionType === 'landingpage') return match;

    return buildContentMentionLink(courseId, { type: mentionType, id, title }, escapeHtml(title), targets);
  });
}
