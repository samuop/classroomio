<script lang="ts">
  import { Tabs as TabsPrimitive } from 'bits-ui';
  import { cn } from '../../tools';

  let { ref = $bindable(null), class: className, children, ...restProps }: TabsPrimitive.ListProps = $props();
</script>

<!--
  Wraps rather than scrolling sideways. It used to be `h-9 overflow-x-auto` with
  the scrollbar hidden, so any tab past the container's width was simply cut off
  at the edge with nothing to indicate it was there — in the add-video dialog the
  fifth tab ("Google Drive") was sliced in half by the modal border. Hiding a
  navigation control behind an invisible scrollbar is never the right trade.

  `min-h-9` instead of `h-9` so a second row can grow; the fixed height moves to
  each trigger's wrapper, which is what the active underline is positioned
  against. When everything fits on one row — the common case — nothing changes.
-->
<TabsPrimitive.List
  bind:ref
  data-slot="underline-tabs-list"
  class={cn(
    'ui:text-muted-foreground ui:border-border ui:relative ui:inline-flex ui:min-h-9 ui:w-full ui:max-w-full ui:flex-wrap ui:items-center ui:justify-start ui:border-b',
    className
  )}
  {...restProps}
>
  {@render children?.()}
</TabsPrimitive.List>
