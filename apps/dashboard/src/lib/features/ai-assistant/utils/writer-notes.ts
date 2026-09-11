import { getAgentToolName, getAgentToolResult, getAgentToolStatus, isAgentToolPart } from './tool-parts';

/** Something the lesson writer could not cover, for one lesson. */
export interface WriterNote {
  lessonId: string;
  title: string;
  note: string;
}

/**
 * The notes `write_lesson` returned in one assistant message.
 *
 * The lesson writer works with a clean context and cannot talk to the teacher,
 * so what it could not cover — missing material, a lesson written from general
 * practice, a source cut short — comes back as `writerNote` on the tool result.
 * The prompt tells the agent to relay every one. Measured in dev, it did not: a
 * note saying a lesson had no internal material behind it never reached the
 * teacher, and the summary described that lesson as if it were complete.
 *
 * So the note is read straight from the tool result and shown open in the
 * message, instead of depending on the agent to repeat it. It cannot go inside
 * the agent steps: those start collapsed on a finished message.
 */
export function getWriterNotes(parts: readonly unknown[]): WriterNote[] {
  const notes: WriterNote[] = [];

  for (const part of parts) {
    if (!isAgentToolPart(part) || getAgentToolName(part) !== 'write_lesson') continue;

    // Only a finished call has a note to show; a running one has no result yet.
    if (getAgentToolStatus(part) !== 'completed') continue;

    const result = getAgentToolResult(part) as Record<string, unknown> | null | undefined;
    const note = typeof result?.writerNote === 'string' ? result.writerNote.trim() : '';

    if (!note) continue;

    notes.push({
      lessonId: typeof result?.lessonId === 'string' ? result.lessonId : '',
      title: typeof result?.lessonTitle === 'string' ? result.lessonTitle : '',
      note
    });
  }

  return notes;
}
