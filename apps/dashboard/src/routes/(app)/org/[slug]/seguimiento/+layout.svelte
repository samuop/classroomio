<script lang="ts">
  import { page } from '$app/state';
  import type { Snippet } from 'svelte';
  import { t } from '$lib/utils/functions/translations';
  import { currentOrgPath } from '$lib/utils/store/org';
  import { brandName } from '$lib/utils/branding';
  import * as Page from '@cio/ui/base/page';

  let { children }: { children?: Snippet } = $props();

  const base = $derived(`${$currentOrgPath}/seguimiento`);

  const tabs = $derived([
    { key: 'summary', label: $t('tracking.tab_summary'), href: base },
    { key: 'at_risk', label: $t('tracking.tab_at_risk'), href: `${base}/en-riesgo` },
    { key: 'compliance', label: $t('tracking.tab_compliance'), href: `${base}/cumplimiento` }
  ]);

  // Active tab = deepest matching href (so the base path doesn't also light up
  // the sub-tabs). Longest href that prefixes the current path wins.
  const activeHref = $derived.by(() => {
    const path = page.url.pathname;
    return tabs
      .map((tab) => tab.href)
      .filter((href) => path === href || path.startsWith(`${href}/`))
      .sort((a, b) => b.length - a.length)[0];
  });
</script>

<svelte:head>
  <title>{$t('tracking.title')} - {brandName}</title>
</svelte:head>

<Page.Root class="w-full">
  <Page.Header>
    <Page.HeaderContent>
      <Page.Title>{$t('tracking.title')}</Page.Title>
      <p class="text-muted-foreground text-sm">{$t('tracking.subtitle')}</p>
    </Page.HeaderContent>
  </Page.Header>

  <nav class="border-border mb-6 flex gap-1 overflow-x-auto border-b" aria-label={$t('tracking.title')}>
    {#each tabs as tab (tab.key)}
      {@const active = tab.href === activeHref}
      <a
        href={tab.href}
        class="relative -mb-px whitespace-nowrap rounded-t-md px-4 py-2.5 text-sm font-medium transition-colors
          {active
          ? 'border-primary text-primary border-b-2'
          : 'text-muted-foreground hover:text-foreground border-b-2 border-transparent'}"
        aria-current={active ? 'page' : undefined}
      >
        {tab.label}
      </a>
    {/each}
  </nav>

  <Page.Body>
    {#snippet child()}
      {@render children?.()}
    {/snippet}
  </Page.Body>
</Page.Root>
