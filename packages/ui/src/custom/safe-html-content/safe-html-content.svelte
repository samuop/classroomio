<script lang="ts">
  import type { Snippet } from 'svelte';
  import { splitHtmlAndSvg, type ContentSegment, type LessonMediaKind } from '../../tools/sanitize';

  interface Props {
    content: string;
    /**
     * Optional per-diagram overlay, rendered on top of each SVG.
     *
     * Receives the diagram's position among the SVGs of this content — NOT its
     * segment index — because that ordinal is what identifies it server-side when
     * something wants to replace it. Omitted by default, so students and every
     * other caller render exactly as before.
     */
    svgOverlay?: Snippet<[number, string]>;
    /**
     * Renders one of the lesson's own media items where the teacher placed it.
     *
     * The note only ever stores an inert marker — a player written into the HTML
     * would be stripped by the sanitizer, deliberately — so the real Video/Slide/
     * Document component has to be mounted from outside. Without this snippet the
     * marker renders as nothing, which is correct for every caller that has no
     * lesson to resolve it against.
     */
    mediaEmbed?: Snippet<[LessonMediaKind, string]>;
  }

  let { content, svgOverlay, mediaEmbed }: Props = $props();

  const segments: ContentSegment[] = $derived(splitHtmlAndSvg(content));

  /**
   * Position of each segment among the SVG segments only. `svgOverlay` and the
   * API agree on this numbering; see `listLessonDiagrams` in the API, which must
   * enumerate the same diagrams as `splitHtmlAndSvg`.
   */
  const svgOrdinals: number[] = $derived.by(() => {
    let next = 0;
    return segments.map((segment) => (segment.type === 'svg' ? next++ : -1));
  });

  function svgDimensions(svg: string): { width: string; height: string } {
    const widthMatch = svg.match(/\bwidth\s*=\s*["'](\d+)/i);
    const heightMatch = svg.match(/\bheight\s*=\s*["'](\d+)/i);
    return {
      width: widthMatch ? `${widthMatch[1]}px` : '100%',
      height: heightMatch ? `${heightMatch[1]}px` : '150px'
    };
  }

  function svgSrcdoc(rawSvg: string): string {
    return `<!DOCTYPE html><html><head><style>body{margin:0;display:flex;justify-content:center}</style></head><body>${rawSvg}</body></html>`;
  }
</script>

{#key content}
  {#each segments as segment, i (i)}
    {#if segment.type === 'html'}
      {@html segment.content}
    {:else if segment.type === 'media'}
      {@render mediaEmbed?.(segment.kind, segment.mediaId)}
    {:else}
      {@const dims = svgDimensions(segment.content)}
      {#if svgOverlay}
        <!-- The wrapper exists only to anchor the overlay; without a snippet the
             iframe stays exactly where it was in the flow. -->
        <div style="position:relative;display:block;max-width:100%">
          <iframe
            sandbox=""
            srcdoc={svgSrcdoc(segment.content)}
            title="Embedded diagram"
            style="border:none;overflow:hidden;width:{dims.width};height:{dims.height};max-width:100%"
          ></iframe>
          {@render svgOverlay(svgOrdinals[i], segment.content)}
        </div>
      {:else}
        <iframe
          sandbox=""
          srcdoc={svgSrcdoc(segment.content)}
          title="Embedded diagram"
          style="border:none;overflow:hidden;width:{dims.width};height:{dims.height}"
        ></iframe>
      {/if}
    {/if}
  {/each}
{/key}
