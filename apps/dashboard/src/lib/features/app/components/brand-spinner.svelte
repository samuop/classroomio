<script lang="ts">
  import { brandName } from '$lib/utils/branding';
  import { currentOrg } from '$lib/utils/store/org';
  import { Spinner } from '@cio/ui/base/spinner';

  // Full-screen loading state shown during post-login redirects (root `/` and
  // `/home`) so the org landing page / catalogue doesn't flash. Uses the org's
  // own logo + name (falling back to the deployment brand) instead of the
  // hardcoded ClassroomIO SimpleLogoNav.
  const logoSrc = $derived($currentOrg.avatarUrl || '/logo-192.png');
  const label = $derived($currentOrg.name || brandName);
</script>

<div class="m-2 flex h-screen w-screen flex-col items-center justify-center gap-6 font-sans sm:m-0">
  <div class="flex items-center gap-2">
    <img src={logoSrc} class="h-8 w-8 rounded" alt={label} />
    <span class="text-foreground text-lg font-medium">{label}</span>
  </div>
  <Spinner class="size-14! text-blue-700!" />
</div>
