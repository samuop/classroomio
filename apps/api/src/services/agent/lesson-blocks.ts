/**
 * Addressing lesson content by block instead of by exact text.
 *
 * `edit_lesson_content` replaces by find-and-replace, so the model has to
 * reproduce the fragment it wants to change character for character — same
 * whitespace, same quoting, same HTML entities. Getting any of that wrong fails
 * the edit, and it is the most common way the agent fails at all.
 *
 * Here the SERVER cuts and splices by id and the model only writes the
 * replacement. It is the same shape of fix as `replaceDiagramAt` in diagram.ts,
 * generalised from "the Nth <svg>" to "the block called X".
 */

export const BLOCK_ID_ATTRIBUTE = 'data-block-id';

export interface LessonBlock {
  blockId: string;
  /** The block's full outer HTML, exactly as stored. */
  html: string;
  start: number;
  end: number;
}

/**
 * Matches a top-level element carrying a block id and everything up to its
 * matching close tag.
 *
 * Deliberately not a DOM parse: the API has no DOM, and re-serialising through
 * one would rewrite parts of the lesson this edit never touched. Scanning for
 * the tag boundary keeps every other byte identical.
 */
const BLOCK_OPEN_TAG = new RegExp(
  `<([a-z][a-z0-9]*)\\b[^>]*\\b${BLOCK_ID_ATTRIBUTE}\\s*=\\s*["']([^"']+)["'][^>]*>`,
  'gi'
);

/** Elements that never have a closing tag, so the match ends at the open tag. */
const VOID_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'source',
  'wbr'
]);

/**
 * Finds where `<tag …>` opened at `openStart` closes, honouring nesting of the
 * same tag name (a `<div>` block containing a `<div>` must not stop at the
 * inner close).
 */
function findClosingIndex(content: string, tagName: string, openEnd: number): number {
  const scanner = new RegExp(`<(/?)${tagName}\\b[^>]*>`, 'gi');
  scanner.lastIndex = openEnd;

  let depth = 1;
  let match: RegExpExecArray | null;

  while ((match = scanner.exec(content)) !== null) {
    depth += match[1] === '/' ? -1 : 1;
    if (depth === 0) return scanner.lastIndex;
  }

  // Unbalanced markup: report no block rather than guessing an end and
  // truncating the rest of the lesson.
  return -1;
}

/** Every addressable block in a lesson body, in document order. */
export function listLessonBlocks(content: string): LessonBlock[] {
  if (!content) return [];

  const blocks: LessonBlock[] = [];
  const pattern = new RegExp(BLOCK_OPEN_TAG.source, BLOCK_OPEN_TAG.flags);
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(content)) !== null) {
    const [openTag, tagName, blockId] = match;
    const start = match.index;
    const openEnd = start + openTag.length;

    const isSelfClosing = openTag.endsWith('/>') || VOID_TAGS.has(tagName.toLowerCase());
    const end = isSelfClosing ? openEnd : findClosingIndex(content, tagName, openEnd);

    if (end === -1) continue;

    blocks.push({ blockId, html: content.slice(start, end), start, end });

    // Resume after the block, so a nested element carrying its own id is not
    // reported as a sibling — only top-level blocks are addressable.
    pattern.lastIndex = end;
  }

  return blocks;
}

export function findLessonBlock(content: string, blockId: string): LessonBlock | undefined {
  return listLessonBlocks(content).find((block) => block.blockId === blockId);
}

/** Splice a replacement into the slot the block occupied, leaving all else byte-identical. */
export function replaceLessonBlock(content: string, block: LessonBlock, replacement: string): string {
  return content.slice(0, block.start) + replacement + content.slice(block.end);
}

/**
 * Keeps the block's id on the replacement.
 *
 * Without this a model that returns `<p>new text</p>` silently drops the id, and
 * the block stops being addressable the moment it is first edited — which would
 * make the tool work exactly once per block.
 */
export function preserveBlockId(replacement: string, blockId: string): string {
  const trimmed = replacement.trim();
  const openTag = trimmed.match(/^<([a-z][a-z0-9]*)\b([^>]*)>/i);

  if (!openTag) return trimmed;
  if (new RegExp(`\\b${BLOCK_ID_ATTRIBUTE}\\s*=`, 'i').test(openTag[2])) return trimmed;

  const withId = `<${openTag[1]}${openTag[2]} ${BLOCK_ID_ATTRIBUTE}="${blockId}">`;
  return withId + trimmed.slice(openTag[0].length);
}

/**
 * A compact map of the lesson for the model to choose from: the id and enough
 * text to recognise the block, without shipping the whole body back.
 */
export function summarizeLessonBlocks(content: string, previewLength = 120): Array<{ blockId: string; text: string }> {
  return listLessonBlocks(content).map((block) => {
    const text = block.html
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    return {
      blockId: block.blockId,
      text: text.length > previewLength ? `${text.slice(0, previewLength)}…` : text
    };
  });
}
