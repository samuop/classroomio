<script>
  import { OrgLandingPage } from '$features/org';
  import { globalStore } from '$lib/utils/store/app';
  import { currentOrg } from '$lib/utils/store/org';
  import { user } from '$lib/utils/store/user';
  import BrandSpinner from '$features/app/components/brand-spinner.svelte';
</script>

<!--
  `/home` is the public org landing (course catalogue). A logged-in user only
  passes through here on the way to their dashboard/LMS (routeUserToNextPage
  redirects them). Show the brand spinner instead of the catalogue so it
  doesn't flash.
-->
{#if $user.isLoggedIn}
  <BrandSpinner />
{:else}
  <OrgLandingPage orgSiteName={$globalStore.orgSiteName} org={$currentOrg} />
{/if}
