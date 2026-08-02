import { generateText } from 'ai';
import { AIProvider, SVG_DIAGRAM_RULES, createModel, type AIProviderConfig } from '@cio/ai-assistant';
import { AppError } from '@api/utils/errors';
import { repairSvgGeometry, validateSvgDiagram } from '@api/services/agent/lesson-content';

/**
 * Regenerate a single diagram inside a lesson, optionally following a plain-language
 * instruction from the teacher ("the labels overlap, space them out").
 *
 * Why this is its own path rather than the chat agent's `edit_lesson_content`:
 * that tool replaces by exact string match, which requires the model to reproduce
 * the old SVG character for character — its most common way to fail. Here the
 * SERVER cuts and splices by position and the model only has to write the new
 * diagram. Nothing else in the lesson can be touched, and there is no way to
 * "not find" the target.
 */

/**
 * Canonical way to enumerate the diagrams in a lesson.
 *
 * MUST stay identical to `splitHtmlAndSvg` in `packages/ui/src/tools/sanitize.ts`,
 * because the index the client sends comes from that function's segment order. If
 * the two ever disagree on what counts as an SVG, the wrong diagram gets replaced.
 * `svg-index-parity.test.ts` pins them together.
 */
const SVG_PATTERN = /<svg\b[^>]*>[\s\S]*?<\/svg>/gi;

export interface LessonDiagram {
  index: number;
  svg: string;
  start: number;
  end: number;
}

/** All diagrams in a lesson body, in document order. */
export function listLessonDiagrams(content: string): LessonDiagram[] {
  if (!content) return [];

  const found: LessonDiagram[] = [];
  const pattern = new RegExp(SVG_PATTERN.source, SVG_PATTERN.flags);
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(content)) !== null) {
    found.push({
      index: found.length,
      svg: match[0],
      start: match.index,
      end: match.index + match[0].length
    });
  }

  return found;
}

/** Splice a replacement into the slot the original occupied, leaving all else byte-identical. */
export function replaceDiagramAt(content: string, diagram: LessonDiagram, replacement: string): string {
  return content.slice(0, diagram.start) + replacement + content.slice(diagram.end);
}

/**
 * The prose immediately before the diagram, as context for what it should show.
 * A diagram is almost always illustrating the paragraph that introduces it, and
 * without this the model regenerates from the drawing alone and drifts off-topic.
 */
function surroundingContext(content: string, diagram: LessonDiagram): string {
  return content
    .slice(Math.max(0, diagram.start - 1200), diagram.start)
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(-600);
}

function extractSvg(text: string): string | null {
  const match = text.match(/<svg\b[\s\S]*?<\/svg>/i);
  return match ? match[0] : null;
}

export interface RegenerateDiagramResult {
  svg: string;
  content: string;
  /** Problems the validator still reports after the retry. Empty is the good case. */
  warnings: string[];
  attempts: number;
}

export async function regenerateLessonDiagram(params: {
  content: string;
  index: number;
  lessonTitle: string;
  locale: string;
  instruction?: string;
  providerConfig: AIProviderConfig;
}): Promise<RegenerateDiagramResult> {
  const { content, index, lessonTitle, locale, instruction, providerConfig } = params;

  const diagrams = listLessonDiagrams(content);
  const target = diagrams[index];

  if (!target) {
    throw new AppError(
      `This lesson has ${diagrams.length} diagram(s); there is none at position ${index}. Reload the lesson and try again.`,
      'DIAGRAM_NOT_FOUND',
      404
    );
  }

  const model = createModel(providerConfig);
  const context = surroundingContext(content, target);

  const system = [
    'You redraw a single inline SVG diagram for an online course lesson.',
    'Return ONLY the <svg>…</svg> element. No prose, no markdown fence, no explanation.',
    `Any text inside the diagram must be written in the lesson's language (locale: ${locale}).`,
    '',
    'Follow these rules exactly:',
    SVG_DIAGRAM_RULES
  ].join('\n');

  const task = instruction?.trim()
    ? `The teacher asks for this change: "${instruction.trim()}"\n\nApply it. Keep everything else about the diagram that already works.`
    : 'Redraw this diagram so it communicates the same idea more clearly. Fix anything cramped, overlapping, clipped or hard to read. Keep the same subject.';

  const basePrompt = [
    `Lesson: "${lessonTitle}"`,
    context ? `What the lesson says just before the diagram: ${context}` : '',
    '',
    'Current diagram:',
    target.svg,
    '',
    task
  ]
    .filter(Boolean)
    .join('\n');

  let attempts = 0;
  let best: { svg: string; warnings: string[] } | null = null;
  let feedback = '';

  // Two passes at most. The validator earns its keep here: it caught all three
  // defective diagrams in a real course with no false positives, so handing its
  // complaints straight back closes the loop without bothering the teacher.
  while (attempts < 2) {
    attempts += 1;

    const { text } = await generateText({
      model,
      system,
      prompt: feedback ? `${basePrompt}\n\n${feedback}` : basePrompt,
      maxOutputTokens: 4096,
      maxRetries: 1,
      ...(providerConfig.provider === AIProvider.GOOGLE
        ? { providerOptions: { google: { thinkingConfig: { thinkingBudget: 0 } } } }
        : {})
    });

    const raw = extractSvg(text);
    if (!raw) {
      feedback = 'Your previous answer contained no <svg> element. Reply with the SVG only.';
      continue;
    }

    const svg = repairSvgGeometry(raw);
    const warnings = validateSvgDiagram(svg);

    // Keep the first result even if imperfect: a diagram with a warning still
    // beats refusing to change anything, and the warnings go back to the teacher.
    if (!best || warnings.length < best.warnings.length) best = { svg, warnings };
    if (warnings.length === 0) break;

    feedback = `Your previous attempt has these problems:\n${warnings.map((w) => `- ${w}`).join('\n')}\nFix them and return the corrected SVG only.`;
  }

  if (!best) {
    throw new AppError(
      'The model did not return a usable diagram. Try again, or rephrase the instruction.',
      'DIAGRAM_GENERATION_FAILED',
      502
    );
  }

  return {
    svg: best.svg,
    content: replaceDiagramAt(content, target, best.svg),
    warnings: best.warnings,
    attempts
  };
}
