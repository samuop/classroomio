/**
 * Addressing lesson content by block id.
 *
 * The property that matters is the same one `replaceDiagramAt` guarantees for
 * diagrams: everything outside the targeted block comes out byte-identical. The
 * model writing a replacement must not be able to disturb the rest of the
 * lesson, and it must never have to reproduce what it is replacing.
 */
import { describe, expect, it } from 'vitest';

import {
  findLessonBlock,
  listLessonBlocks,
  preserveBlockId,
  replaceLessonBlock,
  summarizeLessonBlocks
} from '@api/services/agent/lesson-blocks';

const DOC =
  '<h3 data-block-id="a">Intro</h3>' +
  '<p data-block-id="b">First paragraph with &amp; an entity.</p>' +
  '<p data-block-id="c">Second paragraph.</p>';

describe('listLessonBlocks', () => {
  it('finds every top-level block in document order', () => {
    expect(listLessonBlocks(DOC).map((block) => block.blockId)).toEqual(['a', 'b', 'c']);
  });

  it('captures the block outer HTML verbatim', () => {
    const [, second] = listLessonBlocks(DOC);

    // Entities intact: this is the exact thing edit_lesson_content makes the
    // model retype, and the reason it fails.
    expect(second.html).toBe('<p data-block-id="b">First paragraph with &amp; an entity.</p>');
  });

  it('does not report a nested block as a sibling', () => {
    const nested = '<div data-block-id="outer"><p data-block-id="inner">hi</p></div>';

    expect(listLessonBlocks(nested).map((block) => block.blockId)).toEqual(['outer']);
  });

  it('handles same-tag nesting without stopping at the inner close', () => {
    const nested = '<div data-block-id="outer"><div>inner</div>tail</div><p data-block-id="after">x</p>';
    const [outer] = listLessonBlocks(nested);

    expect(outer.html).toBe('<div data-block-id="outer"><div>inner</div>tail</div>');
    expect(listLessonBlocks(nested).map((block) => block.blockId)).toEqual(['outer', 'after']);
  });

  it('handles void elements, which have no closing tag', () => {
    const blocks = listLessonBlocks('<hr data-block-id="rule"><p data-block-id="p">after</p>');

    expect(blocks.map((block) => block.blockId)).toEqual(['rule', 'p']);
    expect(blocks[0].html).toBe('<hr data-block-id="rule">');
  });

  it('skips a block whose tag is never closed rather than swallowing the rest', () => {
    // Truncating to the end of the document would delete everything after it on
    // the next splice. Reporting nothing is the safe failure.
    expect(listLessonBlocks('<div data-block-id="broken">no close')).toEqual([]);
  });

  it('returns nothing for content that predates block ids', () => {
    expect(listLessonBlocks('<p>old lesson</p>')).toEqual([]);
    expect(listLessonBlocks('')).toEqual([]);
  });

  it('accepts single-quoted attributes', () => {
    expect(listLessonBlocks("<p data-block-id='q'>x</p>").map((b) => b.blockId)).toEqual(['q']);
  });
});

describe('replaceLessonBlock', () => {
  it('leaves every other byte untouched', () => {
    const block = findLessonBlock(DOC, 'b')!;
    const updated = replaceLessonBlock(DOC, block, '<p data-block-id="b">Rewritten.</p>');

    expect(updated).toBe(
      '<h3 data-block-id="a">Intro</h3>' +
        '<p data-block-id="b">Rewritten.</p>' +
        '<p data-block-id="c">Second paragraph.</p>'
    );
  });

  it('deletes the block when the replacement is empty', () => {
    const block = findLessonBlock(DOC, 'c')!;

    expect(replaceLessonBlock(DOC, block, '')).toBe(
      '<h3 data-block-id="a">Intro</h3><p data-block-id="b">First paragraph with &amp; an entity.</p>'
    );
  });

  it('does not interpret $ sequences in the replacement', () => {
    // A regex-based replace would expand `$&` into the matched text.
    const block = findLessonBlock(DOC, 'a')!;
    const updated = replaceLessonBlock(DOC, block, '<h3>Cost: $& $1 $$</h3>');

    expect(updated).toContain('<h3>Cost: $& $1 $$</h3>');
  });
});

describe('preserveBlockId', () => {
  it('re-attaches the id when the model omits it', () => {
    // Without this the block stops being addressable after its first edit, so
    // the tool would work exactly once per block.
    expect(preserveBlockId('<p>New text</p>', 'b')).toBe('<p data-block-id="b">New text</p>');
  });

  it('leaves an id the model already wrote', () => {
    expect(preserveBlockId('<p data-block-id="b">New</p>', 'b')).toBe('<p data-block-id="b">New</p>');
  });

  it('keeps other attributes on the replacement', () => {
    expect(preserveBlockId('<p class="lead">New</p>', 'b')).toBe('<p class="lead" data-block-id="b">New</p>');
  });

  it('passes through a replacement with no leading tag', () => {
    expect(preserveBlockId('just text', 'b')).toBe('just text');
  });
});

describe('summarizeLessonBlocks', () => {
  it('gives the model an id and readable text, not the markup again', () => {
    expect(summarizeLessonBlocks(DOC)).toEqual([
      { blockId: 'a', text: 'Intro' },
      { blockId: 'b', text: 'First paragraph with &amp; an entity.' },
      { blockId: 'c', text: 'Second paragraph.' }
    ]);
  });

  it('truncates long blocks', () => {
    const long = `<p data-block-id="x">${'word '.repeat(80)}</p>`;
    const [summary] = summarizeLessonBlocks(long, 20);

    expect(summary.text).toHaveLength(21);
    expect(summary.text.endsWith('…')).toBe(true);
  });
});
