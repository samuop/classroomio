<script lang="ts">
  import { marcarDentroDeModal } from '../z-layers';
  import { Dialog as DialogPrimitive } from 'bits-ui';
  import type { Snippet } from 'svelte';
  import * as Dialog from './index';
  import { cn, type WithoutChildrenOrChild } from '../../tools';
  import CrossIcon from '@lucide/svelte/icons/x';

  /**
   * Widths must be declared HERE, not passed in as a class.
   *
   * This package compiles its utilities with the `ui` prefix, and only scans its
   * own source, so a `ui:sm:max-w-2xl` written in an app is a class that never
   * gets generated — while `cn()` still drops the default it collided with,
   * leaving the dialog with no width at all. The add-video modal shipped that
   * way. An enumerated prop keeps the literals in a file Tailwind reads.
   */
  const SIZE_CLASS = {
    sm: 'ui:sm:max-w-sm',
    md: 'ui:sm:max-w-lg',
    lg: 'ui:sm:max-w-2xl',
    xl: 'ui:sm:max-w-4xl'
  } as const;

  let {
    ref = $bindable(null),
    class: className,
    portalProps,
    children,
    showCloseButton = true,
    size = 'md',
    ...restProps
  }: WithoutChildrenOrChild<DialogPrimitive.ContentProps> & {
    portalProps?: DialogPrimitive.PortalProps;
    children: Snippet;
    showCloseButton?: boolean;
    size?: keyof typeof SIZE_CLASS;
  } = $props();

  // Todo overlay anclado que se abra aca adentro tiene que subir a
  // OVERLAY_IN_MODAL, o queda pintado por debajo de este panel. Ver ../z-layers.
  marcarDentroDeModal();
</script>

<Dialog.Portal {...portalProps}>
  <Dialog.Overlay />
  <DialogPrimitive.Content
    bind:ref
    data-slot="dialog-content"
    class={cn(
      'ui:bg-background ui:border ui:data-[state=open]:animate-in ui:data-[state=closed]:animate-out ui:data-[state=closed]:fade-out-0 ui:data-[state=open]:fade-in-0 ui:data-[state=closed]:zoom-out-95 ui:data-[state=open]:zoom-in-95 ui:fixed ui:left-[50%] ui:top-[50%] ui:z-200 ui:grid ui:w-full ui:max-w-[calc(100%-2rem)] ui:translate-x-[-50%] ui:translate-y-[-50%] ui:gap-4 ui:rounded-lg ui:p-6 ui:shadow-lg ui:duration-200',
      SIZE_CLASS[size],
      className
    )}
    {...restProps}
  >
    {@render children?.()}
    {#if showCloseButton}
      <DialogPrimitive.Close
        class="ui:ring-offset-background ui:focus:ring-ring ui:rounded-xs ui:focus:outline-hidden ui:absolute ui:top-4 ui:opacity-70 ui:transition-opacity ui:hover:opacity-100 ui:focus:ring-2 ui:focus:ring-offset-2 ui:disabled:pointer-events-none ui:[&_svg:not([class*='size-'])]:size-4 ui:[&_svg]:pointer-events-none ui:[&_svg]:shrink-0 ui:end-4 ui:cursor-pointer"
      >
        <CrossIcon class="custom" />
        <span class="ui:sr-only">Close</span>
      </DialogPrimitive.Close>
    {/if}
  </DialogPrimitive.Content>
</Dialog.Portal>
