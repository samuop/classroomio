<script lang="ts">
  import { resolve } from '$app/paths';
  import { t } from '$lib/utils/functions/translations';
  import { brandName } from '$lib/utils/branding';
  import OrgLogo from '$features/ui/org-logo.svelte';

  interface Props {
    logo: string | undefined;
    orgName: string | undefined;
  }

  let { logo, orgName }: Props = $props();
</script>

<div class="logo">
  <a
    href={resolve('/', {})}
    title={`${$t('navigation.goto')} ${orgName || brandName} ${$t('navigation.home')}`}
    class="flex items-center gap-2"
    id="logo"
    data-hveid="8"
  >
    <OrgLogo src={logo} name={orgName || brandName} class="h-9 w-9" />
    {#if orgName}
      <span class="line-clamp-1 hidden text-sm font-medium md:block">{orgName}</span>
    {/if}
  </a>
</div>
