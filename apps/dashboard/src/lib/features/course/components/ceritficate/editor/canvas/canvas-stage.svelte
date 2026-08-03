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
    keepReachable,
    moveRect,
    resizeRect,
    snapRect,
    substituteBindings,
    type BindingValues,
    type CertificateElement,
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

  function recomputeScale() {
    if (!viewport) return;

    const rect = viewport.getBoundingClientRect();
    if (rect.width === 0) return;

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

  function imageUrl(element: CertificateElement): string | undefined {
    if (element.kind !== 'image') return undefined;

    if (element.source.kind === 'upload') return element.source.url;
    if (element.source.kind === 'clientLogo') return store.draft.clientBrandLogoUrl || undefined;

    return undefined;
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

  const HANDLE_POSITION: Record<ResizeHandle, string> = {
    nw: 'left:-4px;top:-4px;cursor:nwse-resize',
    n: 'left:calc(50% - 4px);top:-4px;cursor:ns-resize',
    ne: 'right:-4px;top:-4px;cursor:nesw-resize',
    e: 'right:-4px;top:calc(50% - 4px);cursor:ew-resize',
    se: 'right:-4px;bottom:-4px;cursor:nwse-resize',
    s: 'left:calc(50% - 4px);bottom:-4px;cursor:ns-resize',
    sw: 'left:-4px;bottom:-4px;cursor:nesw-resize',
    w: 'left:-4px;top:calc(50% - 4px);cursor:ew-resize'
  };
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  bind:this={viewport}
  class="ui:bg-muted/40 relative flex h-full w-full items-center justify-center overflow-hidden rounded-md p-4"
  role="application"
  aria-label="Certificate canvas"
  tabindex="-1"
  onkeydown={nudge}
>
  <div
    class="ui:bg-background relative shadow-lg"
    style="width:{CANVAS_WIDTH}px;height:{CANVAS_HEIGHT}px;transform:scale({scale});transform-origin:center center;background-color:{canvas?.color ??
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
          isSelected && 'ui:outline-primary outline-2',
          !isSelected && overflows && 'outline-1 outline-amber-500'
        )}
        style="left:{element.x}px;top:{element.y}px;width:{element.w}px;height:{element.h}px;opacity:{element.opacity ??
          1};{element.rotation ? `transform:rotate(${element.rotation}deg);` : ''}"
        onpointerdown={(event) => startMove(event, element)}
      >
        {#if element.kind === 'text'}
          <div
            class="pointer-events-none flex h-full w-full"
            style="align-items:{element.style.verticalAlign === 'top'
              ? 'flex-start'
              : element.style.verticalAlign === 'bottom'
                ? 'flex-end'
                : 'center'}"
          >
            <div
              style="width:100%;font-family:'{element.style.fontFamily}',serif;font-size:{element.style
                .fontSize}px;font-weight:{element.style.fontWeight};line-height:{element.style
                .lineHeight};letter-spacing:{element.style.letterSpacing}px;color:{element.style
                .color};text-align:{element.style.align};{element.style.italic
                ? 'font-style:italic;'
                : ''}{element.style.uppercase ? 'text-transform:uppercase;' : ''}overflow-wrap:break-word"
            >
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
              class="ui:bg-primary absolute h-2 w-2 rounded-[1px]"
              style={HANDLE_POSITION[handle]}
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
