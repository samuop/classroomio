// Imported from the module, not the `tools` barrel: the barrel also pulls in
// render-math, which imports KaTeX's stylesheet and blows up under Jest.
import { splitHtmlAndSvg, listLessonMediaRefs, LESSON_MEDIA_ATTR } from '@cio/ui/tools/sanitize';

/**
 * Notes can now position the lesson's own media inline. The note stores an inert
 * marker, never a player: `iframe` is forbidden and `ALLOW_DATA_ATTR` is false,
 * so an embedded player written into a note is stripped on render — the very
 * protection that stops an AI-written note from embedding third-party content.
 *
 * The splitter is the seam. Getting it wrong either drops a teacher's media or,
 * worse, mangles the surrounding note, so these lock its edges.
 */

const marker = (kind: string, id: string) =>
  `<div ${LESSON_MEDIA_ATTR.kind}="${kind}" ${LESSON_MEDIA_ATTR.id}="${id}"></div>`;

const SVG = '<svg viewBox="0 0 10 10" width="10" height="10"><rect x="0" y="0" width="2" height="2"/></svg>';

describe('splitHtmlAndSvg — lesson media markers', () => {
  it('turns a marker into its own segment and keeps the prose around it', () => {
    const segments = splitHtmlAndSvg(`<p>Antes.</p>${marker('video', 'vid-1')}<p>Después.</p>`);

    expect(segments).toHaveLength(3);
    expect(segments[0]).toMatchObject({ type: 'html' });
    expect(segments[1]).toEqual({ type: 'media', kind: 'video', mediaId: 'vid-1' });
    expect(segments[2]).toMatchObject({ type: 'html' });
    expect(segments[0].type === 'html' && segments[0].content).toContain('Antes.');
    expect(segments[2].type === 'html' && segments[2].content).toContain('Después.');
  });

  it('reads the marker whatever order its attributes are written in', () => {
    const reversed = `<div ${LESSON_MEDIA_ATTR.id}="doc-9" ${LESSON_MEDIA_ATTR.kind}="document"></div>`;

    expect(listLessonMediaRefs(reversed)).toEqual([{ kind: 'document', mediaId: 'doc-9' }]);
  });

  it('keeps markers and diagrams in document order', () => {
    const segments = splitHtmlAndSvg(`${marker('video', 'v1')}${SVG}${marker('slide', 's1')}`);

    expect(segments.map((s) => s.type)).toEqual(['media', 'svg', 'media']);
  });

  it('does not disturb the SVG numbering the diagram tools rely on', () => {
    // The redraw control identifies a diagram by its position among the SVGs.
    // Markers must not be counted, or the wrong picture gets replaced.
    const withMarkers = splitHtmlAndSvg(`${marker('video', 'v1')}${SVG}${marker('slide', 's1')}${SVG}`);
    const svgOnly = withMarkers.filter((s) => s.type === 'svg');

    expect(svgOnly).toHaveLength(2);
  });

  it('leaves an incomplete marker as ordinary HTML instead of swallowing it', () => {
    // Missing id: rendering it as markup is the debuggable failure; silently
    // dropping the element is not.
    const segments = splitHtmlAndSvg(`<p>x</p><div ${LESSON_MEDIA_ATTR.kind}="video"></div>`);

    expect(segments.every((s) => s.type === 'html')).toBe(true);
  });

  it('ignores a marker whose kind is not one we can render', () => {
    const segments = splitHtmlAndSvg(`<div ${LESSON_MEDIA_ATTR.kind}="hologram" ${LESSON_MEDIA_ATTR.id}="h1"></div>`);

    expect(segments.every((s) => s.type === 'html')).toBe(true);
  });

  it('leaves notes without markers exactly as they were', () => {
    const plain = '<h3>Título</h3><p>Sólo texto.</p>';
    const segments = splitHtmlAndSvg(plain);

    expect(segments).toHaveLength(1);
    expect(segments[0].type).toBe('html');
  });

  it('lists every reference in order, including repeats', () => {
    const html = `${marker('video', 'v1')}<p>a</p>${marker('document', 'd1')}<p>b</p>${marker('video', 'v1')}`;

    expect(listLessonMediaRefs(html)).toEqual([
      { kind: 'video', mediaId: 'v1' },
      { kind: 'document', mediaId: 'd1' },
      { kind: 'video', mediaId: 'v1' }
    ]);
  });
});
