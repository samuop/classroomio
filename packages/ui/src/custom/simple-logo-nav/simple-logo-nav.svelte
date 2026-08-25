<script lang="ts">
  /**
   * La marca que corona las pantallas sin sesión: error, 404, ingreso,
   * invitación, página restringida.
   *
   * Acá vivía un cartel de ClassroomIO — isotipo, el nombre, el eslogan
   * "Finally, A Course Platform That's Beautiful & Easy To Use" y un link a
   * classroomio.com. Aparecía JUSTO cuando algo se rompía: la pantalla que más
   * se mira en el peor momento era publicidad del proyecto original, con un
   * link que se llevaba al usuario afuera.
   *
   * Ahora es el nombre de la marca en texto plano, igual que el "Desarrollado
   * por" del pie. **Sin imagen a propósito**: el único isotipo que trae el repo
   * es el de ClassroomIO, y una marca prestada es peor que ninguna. El día que
   * haya un logo propio, va acá y en `static/`.
   *
   * Se lee de `import.meta.env` y no de `$lib/utils/branding` porque esto vive
   * en `packages/ui`, que no puede importar del dashboard. Vite reemplaza el
   * valor al compilar (el `envPrefix` del dashboard incluye `PUBLIC_`).
   */
  const envBrandName = (import.meta as { env?: Record<string, string | undefined> }).env?.PUBLIC_BRAND_NAME;
  const brandName = envBrandName?.trim() || 'Tensor Tech';
</script>

{#if brandName}
  <div
    class="ui:absolute ui:top-2 ui:border ui:border-dashed ui:px-4 ui:py-1 ui:rounded-md ui:flex ui:items-center ui:justify-center"
  >
    <span class="ui:text-muted-foreground ui:text-sm">{brandName}</span>
  </div>
{/if}
