<script>
  import { page } from '$app/state';
  import { Button } from '@cio/ui/base/button';
  import { Empty } from '@cio/ui/custom/empty';
  import { HomeIcon, HoverableItem } from '@cio/ui/custom/moving-icons';
  import HeartCrack from '@lucide/svelte/icons/heart-crack';

  const isNotFound = $derived(page.status === 404);

  console.error('Error message:', page.error?.message);
  console.error('Error page:', page.url);

  function goHome() {
    window.location.href = '/';
  }
</script>

<svelte:head>
  <title>{isNotFound ? 'Página no encontrada' : 'Ocurrió un error inesperado'}</title>
</svelte:head>

{#if isNotFound}
  <Empty
    title="Página no encontrada"
    description="La página que buscás no existe o no tenés permiso para verla."
    icon={HeartCrack}
    variant="page"
    layout="full-page"
    showLogo={true}
  >
    <div class="flex gap-2">
      <HoverableItem>
        {#snippet children(isHovered)}
          <Button onclick={goHome}>
            <HomeIcon {isHovered} size={16} ariaHidden={true} />
            Ir al inicio
          </Button>
        {/snippet}
      </HoverableItem>
    </div>
  </Empty>
{:else}
  <Empty
    title="Ocurrió un error inesperado."
    description="No te preocupes, tu información está a salvo. Estamos al tanto del problema y lo resolveremos lo antes posible. Por favor, volvé a intentarlo en unos minutos."
    icon={HeartCrack}
    variant="page"
    layout="full-page"
    showLogo={true}
  >
    <div class="flex gap-2">
      <HoverableItem>
        {#snippet children(isHovered)}
          <Button onclick={goHome}>
            <HomeIcon {isHovered} size={16} ariaHidden={true} />
            Ir al inicio
          </Button>
        {/snippet}
      </HoverableItem>
    </div>
  </Empty>
{/if}
