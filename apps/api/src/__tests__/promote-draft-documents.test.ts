/**
 * Promoting wizard drafts into real course sources.
 *
 * The course wizard tells a teacher "we'll use them as a source for your
 * course", but an upload made before the course exists can only go to Redis. It
 * was never moved across, so the material was missing from the Sources panel and
 * deleted outright an hour later — a course built from a document nobody could
 * read again. These tests pin the promotion and, just as importantly, the cases
 * where it must NOT write.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getChatDocument = vi.fn();
const createChatDocument = vi.fn();
const findChatDocumentByContentHash = vi.fn();

vi.mock('@cio/db/queries/agent', () => ({
  getChatDocument: (...args: unknown[]) => getChatDocument(...args),
  createChatDocument: (...args: unknown[]) => createChatDocument(...args),
  findChatDocumentByContentHash: (...args: unknown[]) => findChatDocumentByContentHash(...args)
}));

const { promoteDraftDocuments } = await import('@api/services/agent/document');

const OWNER = { userId: 'teacher-1', courseId: 'course-1', conversationId: 'conv-1' };

function redisWith(entries: Record<string, unknown>) {
  return {
    get: vi.fn(async (key: string) => {
      const found = Object.entries(entries).find(([id]) => key.includes(id));
      return found ? JSON.stringify(found[1]) : null;
    })
  } as unknown as Parameters<typeof promoteDraftDocuments>[2];
}

const draft = {
  text: 'Contenido del apunte de probabilidad.',
  fileName: 'Apuntes.pdf',
  mimeType: 'application/pdf',
  userId: OWNER.userId,
  wordCount: 5,
  pageCount: 165
};

beforeEach(() => {
  vi.clearAllMocks();
  getChatDocument.mockResolvedValue(null);
  findChatDocumentByContentHash.mockResolvedValue(null);
  createChatDocument.mockResolvedValue(undefined);
});

describe('promoteDraftDocuments', () => {
  it('persists a draft as a source of the course', async () => {
    const promoted = await promoteDraftDocuments(['doc-1'], OWNER, redisWith({ 'doc-1': draft }));

    expect(promoted).toBe(1);
    expect(createChatDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'doc-1',
        courseId: 'course-1',
        conversationId: 'conv-1',
        userId: 'teacher-1',
        fileName: 'Apuntes.pdf',
        text: draft.text,
        // Carried from the draft rather than recomputed: a 165-page PDF should
        // not come out of promotion claiming to have no pages.
        pageCount: 165,
        wordCount: 5
      })
    );
  });

  it('keeps the id, so the reference already sent to the model stays valid', async () => {
    await promoteDraftDocuments(['doc-1'], OWNER, redisWith({ 'doc-1': draft }));

    expect(createChatDocument.mock.calls[0][0].id).toBe('doc-1');
  });

  it('does nothing for a document that is already a source', async () => {
    getChatDocument.mockResolvedValue({ id: 'doc-1' });

    expect(await promoteDraftDocuments(['doc-1'], OWNER, redisWith({ 'doc-1': draft }))).toBe(0);
    expect(createChatDocument).not.toHaveBeenCalled();
  });

  it('does not duplicate material the course already has under another id', async () => {
    findChatDocumentByContentHash.mockResolvedValue({ id: 'other' });

    expect(await promoteDraftDocuments(['doc-1'], OWNER, redisWith({ 'doc-1': draft }))).toBe(0);
    expect(createChatDocument).not.toHaveBeenCalled();
  });

  it('refuses another user’s draft', async () => {
    // Ids are guessable-ish nanoids; copying someone else's material into this
    // teacher's course would be a cross-tenant leak.
    const foreign = { ...draft, userId: 'someone-else' };

    expect(await promoteDraftDocuments(['doc-1'], OWNER, redisWith({ 'doc-1': foreign }))).toBe(0);
    expect(createChatDocument).not.toHaveBeenCalled();
  });

  it('skips ids that have already expired out of Redis', async () => {
    expect(await promoteDraftDocuments(['gone'], OWNER, redisWith({}))).toBe(0);
    expect(createChatDocument).not.toHaveBeenCalled();
  });

  it('keeps going when one document fails, so the rest still land', async () => {
    // Best-effort: the chat turn must not die because a source could not be
    // persisted — the model can still read the text out of Redis.
    createChatDocument.mockRejectedValueOnce(new Error('unique violation'));

    const promoted = await promoteDraftDocuments(
      ['doc-1', 'doc-2'],
      OWNER,
      redisWith({ 'doc-1': draft, 'doc-2': { ...draft, text: 'Otro apunte distinto.' } })
    );

    expect(promoted).toBe(1);
    expect(createChatDocument).toHaveBeenCalledTimes(2);
  });
});
