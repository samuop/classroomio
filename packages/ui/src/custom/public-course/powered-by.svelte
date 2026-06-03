<script lang="ts">
  import { cn } from '../../tools';

  interface Props {
    /** Course slug for attribution (passed as ?utm_content=...). */
    courseSlug?: string | null;
    /** Org siteName (or org name) for attribution. */
    orgSlug?: string | null;
    /** Localized label. */
    label?: string;
    /** Brand label shown after the label. */
    brand?: string;
    /** Link target for the attribution. Defaults to '#'. */
    brandHref?: string;
    /** Logo-only footer (narrow sidebars). */
    compact?: boolean;
    /** Row alignment inside the attribution strip. */
    align?: 'center' | 'start';
    /** Override default utm_source (default mirrors public-course pages). */
    utmSource?: string;
    class?: string;
  }

  let {
    courseSlug = null,
    orgSlug = null,
    label = 'Powered by',
    brand = 'Tensor Tech',
    brandHref = '#',
    compact = false,
    align = 'center',
    utmSource = 'public-course',
    class: className
  }: Props = $props();

  const href = $derived(brandHref);

  const rowAlignClass = $derived(align === 'start' ? 'ui:justify-start' : 'ui:justify-center');
</script>

{#if compact}
  <div class={cn('ui:flex ui:items-center ui:gap-1 ui:w-full', rowAlignClass, className)}>
    <a
      {href}
      target="_blank"
      rel="noopener noreferrer"
      class="ui:leading-none ui:opacity-70 ui:hover:opacity-100"
      aria-label={`${label} ${brand}`}
    >
      <img src="/logo-192.png" class="ui:size-6" alt="" />
    </a>
  </div>
{:else}
  <div
    class={cn(
      'ui:px-3 ui:flex ui:items-center ui:gap-1 ui:text-xs ui:text-muted-foreground ui:w-full',
      rowAlignClass,
      className
    )}
  >
    <img src="/logo-192.png" class="ui:size-6" alt={brand} />
    {label}
    <a
      {href}
      target="_blank"
      rel="noopener noreferrer"
      class="ui:font-medium ui:text-muted-foreground ui:underline-offset-2 ui:hover:text-foreground ui:underline"
    >
      {brand}
    </a>
  </div>
{/if}
