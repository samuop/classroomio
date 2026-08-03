/**
 * Which documents a chat turn is allowed to see.
 *
 * This function is the only thing standing between an uploaded file and the
 * agent: whatever it returns gets promoted to a course source and loaded into
 * context, and whatever it misses may as well not have been uploaded. It read
 * `metadata.attachment.documentId` and nothing else, so the course wizard —
 * which accepts up to 10 files — handed over exactly one.
 */
import { describe, expect, it } from 'vitest';
import { collectDocumentIds } from '@api/services/agent/chat-context';

describe('collectDocumentIds', () => {
  it('finds the single attachment on a message', () => {
    const messages = [{ role: 'user', metadata: { attachment: { documentId: 'doc-1' } } }];

    expect(collectDocumentIds(messages)).toEqual(['doc-1']);
  });

  it('finds every document a message carries, not just the primary one', () => {
    // The wizard case: five PDFs uploaded, one of them featured as the chip.
    const messages = [
      {
        role: 'user',
        metadata: {
          attachment: { documentId: 'doc-1', documentIds: ['doc-1', 'doc-2', 'doc-3'] }
        }
      }
    ];

    expect(collectDocumentIds(messages).sort()).toEqual(['doc-1', 'doc-2', 'doc-3']);
  });

  it('gathers documents across the whole conversation', () => {
    const messages = [
      { role: 'user', metadata: { attachment: { documentId: 'doc-1' } } },
      { role: 'assistant' },
      { role: 'user', metadata: { attachment: { documentId: 'doc-2' } } }
    ];

    expect(collectDocumentIds(messages).sort()).toEqual(['doc-1', 'doc-2']);
  });

  it('does not repeat a document attached to several messages', () => {
    // The attachment is sticky for course sources, so the same id rides on
    // every turn — promoting or inlining it twice would be pure waste.
    const messages = [
      { role: 'user', metadata: { attachment: { documentId: 'doc-1', documentIds: ['doc-1', 'doc-2'] } } },
      { role: 'user', metadata: { attachment: { documentId: 'doc-1' } } }
    ];

    expect(collectDocumentIds(messages, 'doc-2').sort()).toEqual(['doc-1', 'doc-2']);
  });

  it('includes the document attached to the current request', () => {
    expect(collectDocumentIds([], 'doc-current')).toEqual(['doc-current']);
  });

  it('ignores messages with no attachment and malformed id lists', () => {
    const messages = [
      { role: 'user' },
      { role: 'user', metadata: {} },
      { role: 'user', metadata: { attachment: { documentId: 'doc-1', documentIds: 'not-an-array' } } },
      { role: 'user', metadata: { attachment: { documentIds: [null, '', 42, 'doc-2'] } } }
    ];

    expect(collectDocumentIds(messages).sort()).toEqual(['doc-1', 'doc-2']);
  });
});
