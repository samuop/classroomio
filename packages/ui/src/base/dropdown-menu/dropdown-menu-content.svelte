<!-- Capa OVERLAY: 150 suelto, 250 dentro de un modal (si no, queda tapado). Ver ../z-layers.ts. -->
<script lang="ts">
  import { claseDeCapaDeOverlay } from '../z-layers';
  import { cn } from '../../tools';
  import { DropdownMenu as DropdownMenuPrimitive } from 'bits-ui';

  let {
    ref = $bindable(null),
    sideOffset = 4,
    portalProps,
    class: className,
    ...restProps
  }: DropdownMenuPrimitive.ContentProps & {
    portalProps?: DropdownMenuPrimitive.PortalProps;
  } = $props();

  const capa = claseDeCapaDeOverlay();
</script>

<DropdownMenuPrimitive.Portal {...portalProps}>
  <DropdownMenuPrimitive.Content
    bind:ref
    data-slot="dropdown-menu-content"
    {sideOffset}
    class={cn(
      capa,
      'ui:bg-popover ui:text-popover-foreground ui:data-[state=open]:animate-in ui:data-[state=closed]:animate-out ui:data-[state=closed]:fade-out-0 ui:data-[state=open]:fade-in-0 ui:data-[state=closed]:zoom-out-95 ui:data-[state=open]:zoom-in-95 ui:data-[side=bottom]:slide-in-from-top-2 ui:data-[side=left]:slide-in-from-right-2 ui:data-[side=right]:slide-in-from-left-2 ui:data-[side=top]:slide-in-from-bottom-2 ui:max-h-(--bits-dropdown-menu-content-available-height) ui:origin-(--bits-dropdown-menu-content-transform-origin) ui:min-w-32 ui:overflow-y-auto ui:overflow-x-hidden ui:rounded-md ui:border ui:p-1 ui:shadow-md ui:outline-none',
      className
    )}
    {...restProps}
  />
</DropdownMenuPrimitive.Portal>
