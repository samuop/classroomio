<script lang="ts">
  import { cn } from '../../tools';

  interface Props {
    /** Localized label (e.g. "Developed by"). */
    label?: string;
    /** Brand label shown after the label. */
    brand?: string;
    /** Brand-text-only footer (narrow sidebars). */
    compact?: boolean;
    /** Row alignment inside the attribution strip. */
    align?: 'center' | 'start';
    class?: string;
    // Note: attribution is plain text (no logo, no link), so the former
    // courseSlug/orgSlug/brandHref/utmSource props are no longer used. Kept out
    // of the interface intentionally; callers may still pass them harmlessly.
    [key: string]: unknown;
  }

  let {
    label = 'Powered by',
    brand = 'Tensor Tech',
    compact = false,
    align = 'center',
    class: className
  }: Props = $props();

  const rowAlignClass = $derived(align === 'start' ? 'ui:justify-start' : 'ui:justify-center');
</script>

{#if compact}
  <!-- Collapsed rail: plain brand text (no logo, no link). -->
  <div class={cn('ui:flex ui:items-center ui:gap-1 ui:w-full ui:text-xs ui:text-muted-foreground ui:whitespace-nowrap ui:min-w-0', rowAlignClass, className)}>
    <span class="ui:font-medium ui:leading-none ui:truncate">{brand}</span>
  </div>
{:else}
  <!-- Plain "<label> <brand>" attribution — no logo, no link. -->
  <div
    class={cn(
      'ui:px-3 ui:flex ui:items-center ui:gap-1 ui:text-xs ui:text-muted-foreground ui:w-full ui:whitespace-nowrap ui:min-w-0',
      rowAlignClass,
      className
    )}
  >
    <span class="ui:shrink-0">{label}</span>
    <span class="ui:font-medium ui:truncate">{brand}</span>
  </div>
{/if}
