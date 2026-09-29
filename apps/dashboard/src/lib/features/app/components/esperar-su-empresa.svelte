<script lang="ts">
  import type { Snippet } from 'svelte';
  import { appInitApi } from '$features/app/init.svelte';
  import BrandSpinner from './brand-spinner.svelte';

  /**
   * No dibuja el área de la persona hasta saber cuál es SU empresa.
   *
   * En el dominio de una empresa, el layout raíz pone de entrada a la dueña del
   * dominio en `currentOrg` —hace falta para el logo y el color— y recién
   * cuando llega la cuenta se la cambia por la empresa de la persona. En el
   * dominio de una consultora casi nunca son la misma: la alumna es de una
   * empresa cliente, no de la consultora. Mientras tanto, cada pantalla que
   * pedía sus datos al montarse los pedía con la empresa equivocada y sin rol.
   * Se medía así: la comunidad devolvía 403 y mandaba a la alumna al panel de
   * administración de la consultora, y tres pantallas de configuración se
   * cargaban vacías y, al guardar, pisaban la configuración real con los
   * valores por defecto.
   *
   * Fuera del dominio de una empresa el hueco es otro, pero igual de roto: la
   * empresa está vacía y el camino base vale '#'. La comunidad, que recibe las
   * preguntas del servidor, armaba sus enlaces con `resolve('#/community/…')` y
   * la pantalla entera se caía («Se rompió esta pantalla»).
   *
   * Arreglarlo pantalla por pantalla dejaba afuera a la próxima que se
   * escribiera. Acá se ataja para todas; sin sesión no hay a quién esperar.
   */
  let {
    conSesion,
    children
  }: {
    conSesion: boolean;
    children?: Snippet;
  } = $props();

  const esperando = $derived(conSesion && !appInitApi.cuentaResuelta);
</script>

{#if esperando}
  <BrandSpinner />
{:else}
  {@render children?.()}
{/if}
