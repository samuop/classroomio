<script lang="ts">
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { isOrgStudent } from '$lib/utils/store/app';
  import * as Sidebar from '@cio/ui/base/sidebar';
  import { Skeleton } from '@cio/ui/base/skeleton';
  import { currentOrg } from '$lib/utils/store/org';
  import { AppHeader } from '$features/ui';
  import { PUBLIC_IS_SELFHOSTED } from '$env/static/public';

  import { VerifyEmailModal } from '$features/onboarding/components';

  import { OrgSidebar } from '$features/ui/sidebar/org-sidebar';
  import { AddOrgModal } from '$features/org';

  let { data, children } = $props();

  function redirect(siteName: string | null) {
    if (!siteName) return;

    const newUrl = page.url.pathname.replace('*', siteName);
    goto(newUrl + page.url.search);
  }

  $effect(() => {
    data.orgName === '*' && redirect($currentOrg.siteName);
  });

  // El área de administración de SU empresa no es para una alumna: a lo sumo le
  // muestra botones que la API le rechaza. Llegaba acá rebotada por un error
  // (ver EsperarSuEmpresa); si otro camino la trae, vuelve a su aprendizaje.
  // Sólo con el rol ya conocido y la empresa de la URL, que es la que se mira.
  $effect(() => {
    if ($isOrgStudent === true && data.orgName === $currentOrg.siteName) {
      goto(resolve('/lms', {}), { replaceState: true });
    }
  });
</script>

{#if PUBLIC_IS_SELFHOSTED !== 'true'}
  <AddOrgModal />
{/if}

<VerifyEmailModal />

<Sidebar.Provider>
  <OrgSidebar />

  <Sidebar.Inset>
    <AppHeader />

    <div class="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 px-4">
      {#if data.orgName === '*'}
        <div class="grid auto-rows-min gap-4 md:grid-cols-3">
          <Skeleton class="aspect-video rounded-xl" />
          <Skeleton class="aspect-video rounded-xl" />
          <Skeleton class="aspect-video rounded-xl" />
        </div>
        <Skeleton class="h-[50vh] w-full rounded-xl" />
      {:else}
        {@render children?.()}
      {/if}
    </div>
  </Sidebar.Inset>
</Sidebar.Provider>
