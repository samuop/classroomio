<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { page } from '$app/state';
  import { startResizablePanelDrag } from '$lib/utils/functions/resizable-panel';
  import { t } from '$lib/utils/functions/translations';
  import { sidePanel } from './utils/store.svelte';

  let railShellElement: HTMLDivElement | null = $state(null);

  let railWidth = $state(0);
  let isWidthLoaded = $state(false);
  let isRailResizing = $state(false);
  let stopRailResize: (() => void) | null = null;

  const activeDefinition = $derived(sidePanel.activeDefinition);
  const activeProps = $derived(sidePanel.panelProps);

  function clampWidth(width: number) {
    const def = activeDefinition;
    if (!def) return width;

    return Math.min(def.maxWidth, Math.max(def.minWidth, width));
  }

  function clearResizeListeners() {
    stopRailResize?.();
    stopRailResize = null;
  }

  function loadWidthForDefinition(def: typeof activeDefinition): number {
    if (!def) return 0;

    try {
      const stored = Number(localStorage.getItem(def.widthStorageKey));
      if (Number.isFinite(stored) && stored > 0) {
        return Math.min(def.maxWidth, Math.max(def.minWidth, stored));
      }
    } catch {
      // localStorage unavailable
    }

    return def.defaultWidth;
  }

  function persistWidthForDefinition(def: typeof activeDefinition, width: number) {
    if (!def) return;

    try {
      localStorage.setItem(def.widthStorageKey, String(Math.round(width)));
    } catch {
      // localStorage unavailable
    }
  }

  $effect(() => {
    const def = activeDefinition;
    if (!def) {
      railWidth = 0;
      isWidthLoaded = false;

      return;
    }

    railWidth = loadWidthForDefinition(def);
    isWidthLoaded = true;
  });

  $effect(() => {
    if (!isWidthLoaded) return;

    persistWidthForDefinition(activeDefinition, railWidth);
  });

  // Lesson-scoped panels should not survive navigating to a different lesson.
  // The rail owns this so host layouts don't have to wire it up themselves.
  let lastLessonId: string | undefined = undefined;

  $effect(() => {
    const lessonId = page.params?.lessonId as string | undefined;

    if (lastLessonId !== undefined && lessonId !== lastLessonId) {
      sidePanel.closeIfScope('lesson');
    }

    lastLessonId = lessonId;
  });

  function handleResizePointerDown(event: PointerEvent) {
    if (!activeDefinition) return;

    event.preventDefault();
    event.stopPropagation();

    clearResizeListeners();

    const startWidth = railWidth;

    stopRailResize = startResizablePanelDrag({
      event,
      startWidth,
      resolveWidth: ({ startWidth, deltaX }) => clampWidth(startWidth - deltaX),
      onPreview: (width) => {
        railShellElement?.style.setProperty('--side-panel-width', `${width}px`);
      },
      onCommit: ({ width }) => {
        railWidth = width;
      },
      onDragStart: () => {
        isRailResizing = true;
      },
      onDragEnd: () => {
        isRailResizing = false;
        stopRailResize = null;
      }
    });
  }

  /**
   * El alto y la posicion REALES de lo que se ve, no los del documento.
   *
   * El panel usaba `h-screen`, o sea `100vh`. En un telefono `100vh` es el alto
   * CON la barra del navegador escondida, siempre mayor que lo visible: el
   * ultimo tramo del panel — justo donde vive la caja de texto — cae abajo del
   * borde de la pantalla. Y cuando se abre el teclado `100vh` no cambia en
   * absoluto, asi que el input queda tapado por el teclado.
   *
   * `100dvh` arregla lo primero pero no lo segundo: sigue sin contar el teclado.
   * El unico que sabe de teclados es visualViewport, que ademas se desplaza
   * (offsetTop) cuando el navegador empuja la pagina hacia arriba. Con esos dos
   * numeros el panel ocupa exactamente el hueco que queda libre.
   */
  let viewportTop = $state(0);
  let viewportHeight = $state<number | null>(null);

  const panelHeightCss = $derived(viewportHeight === null ? '100dvh' : `${viewportHeight}px`);

  onMount(() => {
    const visualViewport = window.visualViewport;

    const syncViewport = () => {
      if (!visualViewport) return;
      viewportTop = visualViewport.offsetTop;
      viewportHeight = visualViewport.height;
    };

    syncViewport();
    visualViewport?.addEventListener('resize', syncViewport);
    visualViewport?.addEventListener('scroll', syncViewport);

    return () => {
      clearResizeListeners();
      visualViewport?.removeEventListener('resize', syncViewport);
      visualViewport?.removeEventListener('scroll', syncViewport);
    };
  });

  /**
   * Con el panel abierto en un telefono ocupa la pantalla entera, y detras
   * seguia scrolleando el curso: se arrastraba en el panel, el panel no tenia
   * mas para scrollear, y el gesto se lo quedaba la pagina de atras. En md+ no
   * corresponde bloquear nada, porque ahi el panel es una columna al costado y
   * el contenido de al lado se sigue leyendo.
   */
  $effect(() => {
    if (!activeDefinition) return;

    const isNarrow = window.matchMedia('(max-width: 767px)');
    let previousOverflow: string | null = null;

    const apply = () => {
      if (isNarrow.matches && previousOverflow === null) {
        previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
      } else if (!isNarrow.matches && previousOverflow !== null) {
        document.body.style.overflow = previousOverflow;
        previousOverflow = null;
      }
    };

    apply();
    isNarrow.addEventListener('change', apply);

    return () => {
      isNarrow.removeEventListener('change', apply);
      if (previousOverflow !== null) document.body.style.overflow = previousOverflow;
    };
  });

  onDestroy(() => {
    clearResizeListeners();
    sidePanel.reset();
  });
</script>

{#if activeDefinition}
  {@const def = activeDefinition}
  <div
    bind:this={railShellElement}
    data-side-panel-resizing={isRailResizing}
    class="contents"
    style={`--side-panel-width: ${railWidth}px; --side-panel-top: ${viewportTop}px; --side-panel-height: ${panelHeightCss};`}
  >
    <div class="hidden shrink-0 md:block md:w-(--side-panel-width)"></div>

    <aside
      class="ui:bg-background fixed right-0 z-100 flex w-full flex-col overscroll-contain border-l top-(--side-panel-top) h-(--side-panel-height) md:w-(--side-panel-width)"
      aria-label={t.get(def.titleKey)}
    >
      <button
        type="button"
        aria-label={t.get('side_panel.resize_panel_aria_label')}
        class="absolute inset-y-0 left-0 hidden w-4 -translate-x-1/2 cursor-col-resize border-0 bg-transparent md:flex"
        onpointerdown={handleResizePointerDown}
      >
        <span class="ui:bg-border pointer-events-none h-full w-px"></span>
      </button>

      <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
        {#key def.id}
          <def.component {...activeProps} />
        {/key}
      </div>
    </aside>
  </div>
{/if}

<style>
  :global([data-side-panel-resizing='true'] *) {
    transition-property: none !important;
  }
</style>
