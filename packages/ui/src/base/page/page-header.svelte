<script lang="ts">
  import { cn, type WithElementRef } from '../../tools';
  import type { HTMLAttributes } from 'svelte/elements';

  let {
    ref = $bindable(null),
    class: className,
    isSticky = false,
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLDivElement>> & {
    isSticky?: boolean;
  } = $props();
</script>

<div
  bind:this={ref}
  data-slot="page-header"
  class={cn(
    'ui:flex ui:my-4 ui:py-2 ui:flex-col',
    isSticky && 'ui:sticky ui:top-11 ui:z-10 ui:bg-background',
    className
  )}
  {...restProps}
>
  <!--
    `flex-wrap` so a long title and a wide action bar stack instead of fighting.
    The `md:` breakpoint reads the VIEWPORT, but panels like the AI assistant
    shrink this container without changing the viewport, so a wide window could
    still leave the title crushed into a few characters per line. Wrapping is
    driven by the actual available width, which is the thing that matters here.
  -->
  <div class="ui:flex ui:items-start ui:justify-between ui:gap-4 ui:flex-col ui:md:flex-row ui:flex-wrap">
    {@render children?.()}
  </div>
</div>
