<script lang="ts">
  /**
   * The editing surface.
   *
   * Elements are real DOM nodes positioned absolutely on a 1100x780 stage that
   * is CSS-scaled to fit the panel. That is deliberate rather than convenient:
   * the exported PDF is HTML rendered by a browser, so editing the same kind of
   * boxes the renderer prints keeps one source of truth. A <canvas> scene graph
   * would need a second renderer to agree with the first, and they never do.
   *
   * Screen pixels are divided by `scale` before anything reaches the geometry
   * helpers, so zoom never leaks into the document's coordinates.
   */
  import {
    CANVAS_HEIGHT,
    CANVAS_WIDTH,
    fitText,
    fontStack,
    keepReachable,
    moveRect,
    resizeRect,
    snapRect,
    substituteBindings,
    type BindingValues,
    type CertificateElement,
    type FitResult,
    type ResizeHandle,
    type SnapGuide
  } from '@cio/certificates';
  import { onMount } from 'svelte';
  import { cn } from '@cio/ui/tools';
  import { certificateEditorStore } from '../store/certificate-editor.store.svelte';

  interface Props {
    values: BindingValues;
    /** Ids the renderer reported as not fitting, surfaced as a warning outline. */
    overflowingIds?: string[];
    disabled?: boolean;
  }

  let { values, overflowingIds = [], disabled = false }: Props = $props();

  const store = certificateEditorStore;

  let viewport = $state<HTMLDivElement | null>(null);
  let scale = $state(0.5);
  let guides = $state<SnapGuide[]>([]);

  /** Null between gestures; holds the pointer origin and the rect it started from. */
  let gesture: {
    kind: 'move' | 'resize';
    handle?: ResizeHandle;
    startX: number;
    startY: number;
    origin: { x: number; y: number; w: number; h: number };
    id: string;
  } | null = null;

  const canvas = $derived(store.draft.document?.canvas);
  const elements = $derived(store.elements);

  /**
   * Fit the canvas to whatever space the panel actually has.
   *
   * Measured on the viewport, which carries NO padding of its own on purpose:
   * `getBoundingClientRect` reports the border box, so padding here would be
   * counted as available room and the canvas would be scaled slightly too large
   * and clipped along its edges. The breathing room comes from the section that
   * wraps this component.
   */
  function recomputeScale() {
    if (!viewport) return;

    const rect = viewport.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    scale = Math.min(rect.width / CANVAS_WIDTH, rect.height / CANVAS_HEIGHT);
  }

  onMount(() => {
    recomputeScale();

    if (typeof ResizeObserver === 'undefined' || !viewport) return;

    const observer = new ResizeObserver(recomputeScale);
    observer.observe(viewport);

    return () => observer.disconnect();
  });

  function startMove(event: PointerEvent, element: CertificateElement) {
    if (disabled || element.locked) return;

    event.preventDefault();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);

    store.select(element.id);
    // One checkpoint per gesture, not per frame: otherwise undoing a single
    // drag would take one press per pointer event.
    store.checkpoint();

    gesture = {
      kind: 'move',
      startX: event.clientX,
      startY: event.clientY,
      origin: { x: element.x, y: element.y, w: element.w, h: element.h },
      id: element.id
    };
  }

  function startResize(event: PointerEvent, element: CertificateElement, handle: ResizeHandle) {
    if (disabled) return;

    event.preventDefault();
    event.stopPropagation();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);

    store.select(element.id);
    store.checkpoint();

    gesture = {
      kind: 'resize',
      handle,
      startX: event.clientX,
      startY: event.clientY,
      origin: { x: element.x, y: element.y, w: element.w, h: element.h },
      id: element.id
    };
  }

  function handleMove(event: PointerEvent) {
    if (!gesture) return;

    const dx = (event.clientX - gesture.startX) / scale;
    const dy = (event.clientY - gesture.startY) / scale;

    if (gesture.kind === 'move') {
      const moved = moveRect(gesture.origin, dx, dy);
      // Alt suspends snapping, for the times a design needs a position the
      // guides keep pulling it off.
      const others = elements.filter((element) => element.id !== gesture!.id);
      const snapped = event.altKey ? { ...moved, guides: [] } : snapRect(moved, others);

      guides = snapped.guides;
      store.updateElement(gesture.id, keepReachable({ x: snapped.x, y: snapped.y, w: snapped.w, h: snapped.h }));
      return;
    }

    const resized = resizeRect(gesture.origin, gesture.handle!, dx, dy, { preserveAspect: event.shiftKey });
    store.updateElement(gesture.id, resized);
  }

  function endGesture(event: PointerEvent) {
    if (!gesture) return;

    (event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);
    gesture = null;
    guides = [];
  }

  function nudge(event: KeyboardEvent) {
    if (disabled || !store.selectedElement) return;

    const step = event.shiftKey ? 10 : 1;
    const deltas: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step]
    };

    const delta = deltas[event.key];

    if (delta) {
      event.preventDefault();
      store.checkpoint();
      const element = store.selectedElement;
      store.updateElement(element.id, { x: element.x + delta[0], y: element.y + delta[1] });
      return;
    }

    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      store.removeSelected();
      return;
    }

    if (event.key === 'Escape') {
      store.select(null);
      return;
    }

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd') {
      event.preventDefault();
      store.duplicateSelected();
      return;
    }

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey) store.redo();
      else store.undo();
    }
  }

  function textPreview(element: CertificateElement): string {
    return element.kind === 'text' ? substituteBindings(element.content, values) : '';
  }

  /**
   * Size the text the way the RENDERER will, not the way the design declares.
   *
   * The stage first drew every string at its designed `fontSize`, which meant a
   * title that the fit engine shrinks to 44px was shown at 66px, spilling out of
   * its box and over its neighbours. The layout looked broken in the editor and
   * would have come out fine in the PDF — the same divergence between preview
   * and export that this whole design exists to avoid, just pointing the other
   * way.
   *
   * Calling `fitText` here is what keeps the two honest: one measurement,
   * shared. It is also why the fit engine had to be pure TypeScript rather than
   * something that measures in the DOM.
   */
  function textFit(element: CertificateElement) {
    if (element.kind !== 'text') return null;

    return fitText(element, textPreview(element));
  }

  function imageUrl(element: CertificateElement): string | undefined {
    if (element.kind !== 'image') return undefined;

    if (element.source.kind === 'upload') return element.source.url;
    if (element.source.kind === 'clientLogo') return store.draft.clientBrandLogoUrl || undefined;

    return undefined;
  }

  /**
   * Mirrors `renderTextElement` in the package renderer, down to the clamp
   * rules. `-webkit-line-clamp` has to sit on this inner element, which is why
   * the vertical alignment lives on a separate flex parent — same structure the
   * renderer emits.
   */
  function textStyle(element: CertificateElement, fit: FitResult | null): string {
    if (element.kind !== 'text' || !fit) return '';

    const { style } = element;
    const rules = [
      'width:100%',
      // Same stack the renderer emits, fallbacks included — a serif standing in
      // for a sans would make the stage disagree with the PDF the moment a font
      // is slow to arrive.
      `font-family:${fontStack(style.fontFamily)}`,
      `font-size:${fit.fontSize}px`,
      `font-weight:${style.fontWeight}`,
      `line-height:${style.lineHeight}`,
      `letter-spacing:${style.letterSpacing}px`,
      `color:${style.color}`,
      `text-align:${style.align}`,
      'overflow-wrap:break-word',
      'white-space:pre-wrap'
    ];

    if (style.italic) rules.push('font-style:italic');
    if (style.uppercase) rules.push('text-transform:uppercase');

    if (element.fit === 'clamp' && fit.maxLines) {
      rules.push(
        'display:-webkit-box',
        '-webkit-box-orient:vertical',
        `-webkit-line-clamp:${fit.maxLines}`,
        'overflow:hidden'
      );
    }

    return rules.join(';');
  }

  /**
   * Mirrors `renderShapeElement` in the package renderer, including the order:
   * an ellipse's 50% wins over an explicit corner radius rather than both being
   * emitted. Two border-radius declarations is what the browser resolves
   * arbitrarily and what makes the stage disagree with the exported PDF.
   */
  function shapeStyle(element: CertificateElement): string {
    if (element.kind !== 'shape') return '';

    const rules: string[] = [];

    if (element.fill) rules.push(`background:${element.fill}`);
    if (element.strokeWidth && element.strokeColor) {
      rules.push(`border:${element.strokeWidth}px solid ${element.strokeColor}`);
    }

    if (element.shape === 'ellipse') rules.push('border-radius:50%');
    else if (element.radius) rules.push(`border-radius:${element.radius}px`);

    if (element.shape === 'line' && !element.fill) {
      rules.push(`background:${element.strokeColor ?? '#000000'}`);
    }

    return rules.join(';');
  }

  const HANDLES: ResizeHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

  const HANDLE_CURSOR: Record<ResizeHandle, string> = {
    nw: 'nwse-resize',
    n: 'ns-resize',
    ne: 'nesw-resize',
    e: 'ew-resize',
    se: 'nwse-resize',
    s: 'ns-resize',
    sw: 'nesw-resize',
    w: 'ew-resize'
  };

  /**
   * Handles sized in CANVAS units so they come out a constant size on screen.
   *
   * They live inside the scaled stage, so a fixed 8px handle renders at 8×scale
   * — about three real pixels at the zoom a 1100px canvas gets in this panel,
   * which is not something anyone can grab. Dividing by the scale cancels it
   * out, and the same trick keeps the selection outline visible.
   */
  const handleSize = $derived(9 / scale);

  function handleStyle(handle: ResizeHandle): string {
    const size = handleSize;
    const offset = -size / 2;
    const centred = `calc(50% - ${size / 2}px)`;

    const vertical = handle.includes('n') ? `top:${offset}px` : handle.includes('s') ? `bottom:${offset}px` : `top:${centred}`;
    const horizontal = handle.includes('w') ? `left:${offset}px` : handle.includes('e') ? `right:${offset}px` : `left:${centred}`;

    return `${vertical};${horizontal};width:${size}px;height:${size}px;cursor:${HANDLE_CURSOR[handle]}`;
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  bind:this={viewport}
  class="ui:bg-muted/40 relative flex h-full w-full items-center justify-center overflow-hidden rounded-md"
  role="application"
  aria-label="Certificate canvas"
  tabindex="-1"
  onkeydown={nudge}
>
  <!--
    Two boxes, and the split is load-bearing.

    `transform: scale()` shrinks an element visually but NOT its layout box, so a
    single scaled stage still occupied 1100x780. That inflated the flex parent
    this component measures itself against, which made `scale` come out wrong,
    which resized the parent again — a feedback loop through the ResizeObserver
    whose visible result was a certificate cropped along its right edge, at the
    wrong aspect ratio.

    The outer box carries the real, scaled dimensions, so ordinary flex centring
    works and nothing overflows. The inner one is the canvas coordinate space,
    scaled from its top-left corner — origin `0 0` rather than `center`, so the
    arithmetic is "multiply by scale" with no offset to get wrong.
  -->
  <div
    class="relative shadow-lg"
    style="width:{CANVAS_WIDTH * scale}px;height:{CANVAS_HEIGHT * scale}px"
  >
    <div
      class="ui:bg-background absolute top-0 left-0 overflow-hidden"
      style="width:{CANVAS_WIDTH}px;height:{CANVAS_HEIGHT}px;transform:scale({scale});transform-origin:0 0;background-color:{canvas?.color ??
        '#ffffff'}"
      onpointermove={handleMove}
      onpointerup={endGesture}
      onpointercancel={endGesture}
      role="presentation"
    >
    {#if canvas?.borderWidth && canvas?.borderColor}
      <div
        class="pointer-events-none absolute"
        style="inset:{canvas.borderInset ?? 0}px;border:{canvas.borderWidth}px solid {canvas.borderColor}"
      ></div>
    {/if}

    {#each elements as element (element.id)}
      {@const isSelected = element.id === store.selectedElementId}
      {@const overflows = overflowingIds.includes(element.id)}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class={cn(
          'absolute',
          !element.locked && !disabled && 'cursor-move',
          isSelected && 'ui:outline-primary',
          !isSelected && overflows && 'outline-amber-500'
        )}
        style="left:{element.x}px;top:{element.y}px;width:{element.w}px;height:{element.h}px;opacity:{element.opacity ??
          1};{element.rotation
          ? `transform:rotate(${element.rotation}deg);`
          : ''}{isSelected || overflows ? `outline-width:${(isSelected ? 2 : 1) / scale}px;outline-style:solid;` : ''}"
        onpointerdown={(event) => startMove(event, element)}
      >
        {#if element.kind === 'text'}
          {@const fit = textFit(element)}
          <div
            class="pointer-events-none flex h-full w-full"
            style="align-items:{element.style.verticalAlign === 'top'
              ? 'flex-start'
              : element.style.verticalAlign === 'bottom'
                ? 'flex-end'
                : 'center'}"
          >
            <div style={textStyle(element, fit)}>
              {textPreview(element)}
            </div>
          </div>
        {:else if element.kind === 'image'}
          {@const url = imageUrl(element)}
          {#if url}
            <img src={url} alt="" class="pointer-events-none h-full w-full" style="object-fit:{element.fit}" />
          {:else}
            <!-- The slot still has to be visible and grabbable while empty, or a
                 teacher cannot position the logo before uploading it. -->
            <div
              class="ui:border-muted-foreground/40 ui:text-muted-foreground flex h-full w-full items-center justify-center border border-dashed text-[10px]"
            >
              {element.source.kind === 'clientLogo' ? 'Logo cliente' : 'Logo'}
            </div>
          {/if}
        {:else}
          <div class="h-full w-full" style={shapeStyle(element)}></div>
        {/if}

        {#if isSelected && !disabled && !element.locked}
          {#each HANDLES as handle (handle)}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
              class="ui:bg-primary ui:border-background absolute"
              style="{handleStyle(handle)};border-width:{1 / scale}px"
              onpointerdown={(event) => startResize(event, element, handle)}
            ></div>
          {/each}
        {/if}
      </div>
    {/each}

    {#each guides as guide, index (index)}
      <div
        class="pointer-events-none absolute bg-fuchsia-500"
        style={guide.axis === 'x'
          ? `left:${guide.position}px;top:0;width:1px;height:${CANVAS_HEIGHT}px`
          : `top:${guide.position}px;left:0;height:1px;width:${CANVAS_WIDTH}px`}
      ></div>
    {/each}
    </div>
  </div>
</div>
