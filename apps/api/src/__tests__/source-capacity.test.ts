/**
 * The cap that ate the teacher's PDF.
 *
 * `createChatDocument` prunes the OLDEST rows once a conversation passes
 * MAX_DOCUMENTS_PER_CONVERSATION, and every source added from the wizard or the
 * Sources panel lands in the same hidden "Course sources" conversation. With the
 * old cap of 10, a deep research run (20 pages) on a course that already had an
 * uploaded PDF deleted that PDF — it was inserted first, so it pruned first. The
 * teacher would have watched the agent build from web pages while their own
 * material was quietly removed from the database.
 *
 * This test exists so that the next person who lowers the cap has to explain
 * themselves to a failing build rather than to a teacher.
 */
import { describe, expect, it } from 'vitest';
import { MAX_DOCUMENTS_PER_CONVERSATION } from '@cio/db/queries/agent/chat-document';

/** Deep research, the largest single batch of sources the product can produce. */
const DEEPEST_RESEARCH_PAGES = 20;

/** MAX_DOCS in the course wizard: how many files a teacher may attach by hand. */
const WIZARD_UPLOAD_LIMIT = 10;

describe('source capacity', () => {
  it('holds a deep research run and the uploads the teacher made by hand, at the same time', () => {
    expect(MAX_DOCUMENTS_PER_CONVERSATION).toBeGreaterThanOrEqual(DEEPEST_RESEARCH_PAGES + WIZARD_UPLOAD_LIMIT);
  });
});
