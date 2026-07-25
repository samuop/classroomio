<script lang="ts">
  import { PublicCoursePoweredBy } from '@cio/ui/custom/public-course';
  import { t } from '$lib/utils/functions/translations';
  import { isFreePlan } from '$lib/utils/store/org';
  import { brandName } from '$lib/utils/branding';
  import { cn } from '@cio/ui/tools';

  type Props = {
    /** Floating promo chip (landing / marketing) vs subdued sidebar attribution. */
    variant?: 'floating' | 'sidebar';
    class?: string;
    /** Sidebar: brand text only when rail is collapsed. */
    showOnlyLogo?: boolean;
    /** Accepted for API compatibility; attribution is plain text (no links/utm). */
    courseSlug?: string | null;
    orgSlug?: string | null;
    sidebarUtmSource?: string;
  };

  let { variant = 'floating', class: className, showOnlyLogo = false }: Props = $props();
</script>

{#if variant === 'sidebar'}
  <PublicCoursePoweredBy
    label={$t('public_course.powered_by.label')}
    brand={brandName}
    compact={showOnlyLogo}
    align={showOnlyLogo ? 'center' : 'start'}
    class={className}
  />
{:else if $isFreePlan}
  <!-- Plain-text attribution (no logo, no link). -->
  <span
    class={cn(
      'fixed right-9 bottom-14 z-50 rounded-md border border-gray-100 bg-white px-2 py-1 text-sm font-medium text-black shadow-sm dark:border-neutral-700 dark:bg-transparent dark:text-white',
      className
    )}
  >
    {$t('course.navItem.landing_page.powered_by')} {brandName}
  </span>
{/if}
