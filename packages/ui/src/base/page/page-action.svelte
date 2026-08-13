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

<div
  bind:this={ref}
  data-slot="page-action"
  class={cn('ui:flex ui:items-center ui:gap-2 ui:shrink-0 ui:flex-wrap', className)}
  {...restProps}
>
  {@render children?.()}
</div>
