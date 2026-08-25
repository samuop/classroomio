<script lang="ts">
  import { page } from '$app/state';
  import { dev } from '$app/environment';

  import { UpgradeModal, PageLoadProgress, PageRestricted } from '$features/ui';
  import { CommandPalette, KeyboardShortcutListener } from '$features/search';
  import { isPublicRoute } from '$lib/utils/functions/routes/isPublicRoute';
  import { currentOrg } from '$lib/utils/store/org';
  import { authClient } from '$lib/utils/services/auth/client';
  import { reportIncident } from '$lib/utils/services/audit/report-incident';

  interface Props {
    children?: import('svelte').Snippet;
    data: {
      isOrgSite: boolean;
      orgSiteName: string;
      org: import('$features/app/types').AccountOrg | null;
      skipAuth: boolean;
      locals: App.Locals;
    };
  }

  let { children, data }: Props = $props();

  let path = $derived(page.url.pathname);

  const session = authClient.useSession();

  /**
   * Un error al dibujar un componente ya montado.
   *
   * `handleError` de SvelteKit NO ve esto: cubre los `load` y la navegación,
   * pero un componente que explota después de montado desmonta su árbol y deja
   * la pantalla en blanco sin avisarle a nadie. Es exactamente lo que pasó
   * revisando el avance de los alumnos.
   */
  function reportRenderError(error: unknown) {
    reportIncident({
      kind: 'FRONTEND_ERROR',
      message: error instanceof Error ? error.message : String(error ?? 'Error al dibujar la pantalla'),
      stack: error instanceof Error ? error.stack : undefined,
      route: path,
      metadata: { origin: 'svelte.boundary', routeId: page.route.id }
    });
  }

  $effect(() => {
    if ($session.isPending || $session.isRefetching || !!$session.data) {
      return;
    }

    if (data.skipAuth) return;

    if (isPublicRoute(path) && (path !== '/' || data.isOrgSite)) {
      return;
    }

    if (!$session.data && !path.startsWith('/login')) {
      window.location.href = '/login';
    }
  });
</script>

<UpgradeModal />
<CommandPalette />
<KeyboardShortcutListener />

{#if data.org?.isRestricted || $currentOrg.isRestricted}
  <PageRestricted />
{:else}
  <PageLoadProgress zIndex={10000} />

  <!--
    Red de contención del dashboard.

    Se dibuja con marcado plano y clases de Tailwind a propósito: es lo que se
    muestra JUSTO cuando algo de la interfaz se rompió, así que no puede depender
    de los componentes que quizás son los que fallaron. (Este repo ya se comió
    esa lección con el barrel de `$features/ui` arrastrando layerchart al grafo
    de SSR — ver el comentario del layout raíz.)

    `reset` vuelve a intentar dibujar sin recargar la página: si el error fue un
    dato que llegó mal una vez, con eso alcanza y la persona no pierde dónde
    estaba.
  -->
  <svelte:boundary onerror={reportRenderError}>
    {@render children?.()}

    {#snippet failed(error, reset)}
      <div class="flex min-h-[60vh] w-full flex-col items-center justify-center gap-4 p-6 text-center">
        <p class="text-lg font-semibold">Se rompió esta pantalla</p>
        <p class="text-muted-foreground max-w-md text-sm">
          El problema ya quedó registrado y lo vamos a revisar. Podés reintentar y seguir trabajando: no perdiste
          nada.
        </p>
        <div class="flex gap-2">
          <button
            class="bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm font-medium"
            onclick={reset}
          >
            Reintentar
          </button>
          <button class="rounded-md border px-4 py-2 text-sm font-medium" onclick={() => window.location.reload()}>
            Recargar la página
          </button>
        </div>

        <!-- El detalle técnico sólo mientras se desarrolla: en producción no le
             dice nada útil a quien lo lee y expone rutas internas. -->
        {#if dev}
          <pre class="max-w-full overflow-x-auto rounded-md bg-black/30 p-3 text-left text-xs">{error instanceof
            Error
              ? (error.stack ?? error.message)
              : String(error)}</pre>
        {/if}
      </div>
    {/snippet}
  </svelte:boundary>
{/if}
