<script lang="ts">
  import { cn, type WithElementRef } from '../../tools';
  import type { HTMLAttributes } from 'svelte/elements';

  let {
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLDivElement>> = $props();
</script>

<!--
  The grow/basis pair is `md:`-only on purpose: below that breakpoint the header
  is a flex COLUMN, where flex-basis sizes height, and an unguarded `basis-80`
  would give every page a 20rem-tall title block on a phone. In row mode the
  basis is what lets the action bar wrap instead of crushing the title.
-->
<div
  bind:this={ref}
  data-slot="page-header-content"
  class={cn('ui:flex ui:flex-col ui:gap-1 ui:min-w-0 ui:md:grow ui:md:basis-80', className)}
  {...restProps}
>
  {@render children?.()}
</div>
