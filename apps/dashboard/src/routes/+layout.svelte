<script lang="ts">
  import { page, updated } from '$app/state';
  import { beforeNavigate } from '$app/navigation';
  import { onMount } from 'svelte';

  // Import the component file directly, NOT the `$features/ui` barrel: the barrel
  // re-exports CourseLandingPage → `@cio/ui` → base/chart → layerchart, which drags
  // a charting library into the SSR graph of every route and makes Vite's dev SSR
  // runner throw "not yet fully initialized due to circular dependency" on
  // layerchart/dist/components/graph/Dagre.svelte. This is the root layout, so the
  // barrel would poison every server-rendered page.
  import Snackbar from '$features/ui/snackbar/snackbar.svelte';
  import { appInitApi } from '$features/app/init.svelte';
  import { setupCloudAnalytics } from '$lib/utils/functions/appSetup';
  import { globalStore } from '$lib/utils/store/app';
  import { currentOrg, mergeAccountOrgFromServer } from '$lib/utils/store/org';
  import { user } from '$lib/utils/store/user';
  import { setTheme } from '$lib/utils/functions/theme';
  import { authClient } from '$lib/utils/services/auth/client';
  import merge from 'lodash/merge';
  import { MetaTags } from 'svelte-meta-tags';
  import { ModeWatcher } from '@cio/ui/base/dark-mode';

  import '../app.css';

  let { data, children } = $props();

  const metaTags = $derived(merge(data.baseMetaTags, page.data.pageMetaTags));

  // Browser-tab favicon. Prefer the reactive store (updates when the user switches org in
  // the dashboard); fall back to the SSR-loaded tenant org; else the platform default.
  // app.html no longer emits any <link rel="icon">, so this is the ONLY one — that way the
  // org's favicon can never lose to a default with an explicit sizes="…".
  // El default es la marca de ESTE despliegue. Antes no había ninguno —el único
  // que traía el repo era el isotipo de ClassroomIO, marca ajena— pero no emitir
  // `<link rel="icon">` tiene un costo: el navegador pide `/favicon.ico` igual,
  // por convención, y eso devolvía 404 en cada pantalla donde todavía no se
  // resolvió la organización (login, error, un tenant sin ícono propio).
  //
  // El archivo se compuso a partir de los dos que la organización ya tenía
  // cargados: el cubo aislado va sobre fondo negro, que es como Tensor presenta
  // su marca. El fondo NO es decorativo — el isotipo es blanco puro (RGB medio
  // 253,253,252), así que sobre una pestaña de tema claro sería invisible.
  const favicon = $derived($currentOrg.favicon || data.org?.favicon || '/favicon.png');

  onMount(() => {
    console.log('Layout', data);

    const loadingIndicator = document.getElementById('app-loading-indicator');
    if (loadingIndicator) {
      loadingIndicator.style.display = 'none';
    }

    const sessionUser = data?.locals?.user;
    setupCloudAnalytics(
      sessionUser ? { id: sessionUser.id, email: sessionUser.email, name: sessionUser.name } : undefined
    );

    if (data?.locals?.user) {
      user.set({
        ...$user,
        isLoggedIn: true,
        currentSession: data.locals.user
      });
    }

    if (data.isOrgSite && data.org) {
      $globalStore.orgSiteName = data.orgSiteName || '';
      $globalStore.isOrgSite = true;
      currentOrg.set(mergeAccountOrgFromServer(data.org));
      setTheme(data.org.theme || 'blue');
    }
  });

  /**
   * Si se desplegó una versión nueva, la próxima navegación recarga entera.
   *
   * Sin esto, quien tenía la aplicación abierta durante un deploy se lleva una
   * pantalla rota: los trozos de código llevan un hash en el nombre, el deploy
   * los reemplaza, y al ir a otra pantalla el navegador pide un archivo que ya
   * no existe ("Failed to fetch dynamically imported module"). No hay forma de
   * recuperarse por dentro —el código que haría falta es justo el que falta—,
   * así que la única salida es pedir la página de nuevo.
   *
   * `willUnload` se respeta para no pisar una navegación que ya sale del sitio.
   * Ver `version.pollInterval` en svelte.config.js, que es lo que enciende
   * `updated`.
   */
  beforeNavigate((navegacion) => {
    if (updated.current && !navegacion.willUnload && navegacion.to?.url) {
      location.href = navegacion.to.url.href;
    }
  });

  const session = authClient.useSession();
  const isSessionReady = $derived(!$session.isPending && !$session.isRefetching && $session.data);

  $effect(() => {
    if (isSessionReady && !appInitApi.isInitializedAndReady && !appInitApi.loading) {
      appInitApi.setupApp($session.data as App.Locals, {
        isOrgSite: data.isOrgSite,
        orgSiteName: data.orgSiteName,
        orgId: data.org?.id ?? null,
        hostOrgId: data.org?.id ?? null,
        hostOrgParentId: data.org?.parentOrganizationId ?? null
      });
    }
  });
</script>

<svelte:head>
  {#if favicon}
    <link rel="icon" href={favicon} />
  {/if}
</svelte:head>

<div>
  <ModeWatcher />

  <MetaTags {...metaTags} />

  <Snackbar />

  {@render children?.()}
</div>

<style>
  :global(:root) {
    --main-primary-color: rgba(29, 78, 216, 1);
    --border-color: #eaecef;
  }

  :global(.dark svg.dark) {
    fill: #fff;
  }

  :global(.border-c) {
    border: 1px solid var(--border-color);
  }

  :global(.border-bottom-c) {
    border-bottom: 1px solid var(--border-color);
  }

  :global(.cards-container) {
    width: 90%;
    margin: 0 auto;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
    column-gap: 12px;
    row-gap: 12px;
  }

  @media screen and (max-width: 768px) {
    :global(.cards-container) {
      width: 95%;
      margin: 0 auto;
      padding: 0;
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
      column-gap: 12px;
      row-gap: 12px;
    }
  }
</style>
