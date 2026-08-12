<script lang="ts">
  import { brandName } from '$lib/utils/branding';
  import { currentOrg } from '$lib/utils/store/org';
  import { Spinner } from '@cio/ui/base/spinner';
  import OrgLogo from '$features/ui/org-logo.svelte';

  // Full-screen loading state shown during post-login redirects (root `/` and
  // `/home`) so the org landing page / catalogue doesn't flash. This is the most
  // visible instance of the logo swap: it is the first thing rendered after
  // login, so a fallback logo here was a foreign brand greeting every user.
  const label = $derived($currentOrg.name || brandName);
</script>

<div class="m-2 flex h-screen w-screen flex-col items-center justify-center gap-6 font-sans sm:m-0">
  <div class="flex items-center gap-2">
    <OrgLogo src={$currentOrg.avatarUrl} name={label} />
    <span class="text-foreground text-lg font-medium">{label}</span>
  </div>
  <Spinner class="size-14! text-blue-700!" />
</div>
