<script lang="ts">
  import { brandName } from '$lib/utils/branding';
  import { onMount } from 'svelte';
  import { resolve } from '$app/paths';
  import type { Component } from 'svelte';

  import { appInitApi } from '$features/app/init.svelte';
  import { Button } from '@cio/ui/base/button';
  import FrownIcon from '@lucide/svelte/icons/frown';
  import { Empty } from '@cio/ui/custom/empty';
  import BrandSpinner from '$features/app/components/brand-spinner.svelte';
  import {
    buildOrgLandingPageProps,
    importThemeComponent,
    normalizeLandingPageSettings
  } from '$features/org/utils/landing-page';
  import { basePath } from '$lib/utils/store/app';
  import { t } from '$lib/utils/functions/translations';
  import { user } from '$lib/utils/store/user';

  let { data } = $props();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let ThemeComponent = $state<Component<any> | null>(null);

  const hasSetupError = $derived(!appInitApi.loading && !!appInitApi.error);

  // A logged-in user landing on `/` is always on the way to their dashboard/LMS
  // (the redirect happens in setupApp -> routeUserToNextPage). In self-hosted
  // mode `isOrgSite`/`org` are always set, so without this guard the org landing
  // page (course catalogue) would flash before that redirect fires.
  const isLoggedIn = $derived(!!data.locals?.user);

  const pageTitle = $derived(
    data.isOrgSite && data.org ? data.org.name : brandName
  );

  const authAction = $derived(
    $user.isLoggedIn
      ? {
          label: t.get($basePath === '/lms' || $basePath === '#' ? 'navigation.goto_lms' : 'navigation.goto_dashboard'),
          href: resolve($basePath !== '#' ? $basePath : '/lms', {})
        }
      : {
          label: t.get('navigation.login'),
          href: '/login'
        }
  );

  const landingPageProps = $derived.by(() => {
    if (!data.isOrgSite || !data.org) return null;

    return buildOrgLandingPageProps(
      data.org,
      normalizeLandingPageSettings(data.org.landingpage),
      data.courses,
      data.hasMoreCourses,
      authAction
    );
  });

  onMount(async () => {
    if (!data.isOrgSite || !data.org || isLoggedIn) {
      if (!appInitApi.loading) {
        appInitApi.setupApp(data.locals, {
          isOrgSite: data.isOrgSite,
          orgSiteName: data.orgSiteName
        });
      }

      return;
    }

    const settings = normalizeLandingPageSettings(data.org.landingpage);
    const mod = await importThemeComponent(settings.theme);
    ThemeComponent = mod.default;
  });
</script>

<svelte:head>
  <title>{pageTitle}</title>
</svelte:head>

{#if data.isOrgSite && data.org && !isLoggedIn}
  {#if ThemeComponent && landingPageProps}
    <ThemeComponent {...landingPageProps} />
  {:else}
    <!-- Theme loading -->
  {/if}
{:else if hasSetupError && !isLoggedIn}
  <Empty
    title="Something Went Wrong"
    description="We encountered an unexpected error. Please reload the page or contact us for support."
    icon={FrownIcon}
    variant="page"
    layout="full-page"
    showLogo={true}
  >
    <p class="my-2 text-red-500">{appInitApi.error}</p>
    <div class="flex gap-2">
      <Button variant="secondary" onclick={() => window.location.reload()}>Reload Page</Button>
      <Button variant="default" href="https://classroomio.com/contact">Contact Us</Button>
    </div>
  </Empty>
{:else}
  <BrandSpinner />
{/if}
