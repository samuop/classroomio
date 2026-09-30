<script lang="ts">
  import { sourcesApi } from '../api/sources.svelte';
  import { leerEstadoDelPlanDelCurso } from '../api/plan-del-curso';
  import { planSinTerminar } from '../utils/plan-del-curso.svelte';
  import { claveDelErrorDeFuente } from '../utils/errores-del-chat';
  import { openAiAssistant, setChatDraft } from '../utils/store';
  import SourceCard from './source-card.svelte';
  import UploadSourceDialog from './upload-source-dialog.svelte';
  import * as Page from '@cio/ui/base/page';
  import { Button } from '@cio/ui/base/button';
  import { t } from '$lib/utils/functions/translations';
  import PlusIcon from '@lucide/svelte/icons/plus';
  import LoaderIcon from '@lucide/svelte/icons/loader';
  import BookOpenIcon from '@lucide/svelte/icons/book-open';
  import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
  import { onMount } from 'svelte';
  import { snackbar } from '$features/ui/snackbar/store';

  let { courseId }: { courseId: string } = $props();

  let uploadDialogOpen = $state(false);

  /**
   * Las fuentes recién agregadas que el plan armado no usa, o `null`.
   *
   * Cada lección del plan ya dice de qué fuentes sale, y el escritor recibe sólo
   * esas: una fuente que llega después queda afuera de la construcción. Medido:
   * una planilla agregada mientras el plan esperaba la aprobación no se usó, y
   * nada lo dijo.
   */
  let fuentesFueraDelPlan = $state<string[] | null>(null);

  onMount(() => {
    void load();
  });

  async function load() {
    await sourcesApi.listSources(courseId);
    if (!sourcesApi.error) {
      await sourcesApi.loadCacheStatuses();
      // Auto-sync: rebuild any missing/expired cache handles in the
      // background so the badges are honest on first paint. Fire-and-forget
      // because it can take a few hundred ms per stale source.
      if (sourcesApi.sources.length > 0) {
        void sourcesApi.reconcileSources(courseId).then(() => {
          // After reconcile finishes, the cacheStatuses map is updated
          // automatically by reconcileSources(). No extra work here.
        });
      }
    } else {
      snackbar.error(t.get('course.sources.snackbar_load_failed'));
    }
  }

  async function handleUploaded(documentId: string) {
    const antes = new Set(sourcesApi.sources.map((fuente) => fuente.id));

    await load();

    if (sourcesApi.error) return;

    snackbar.success(t.get('course.sources.snackbar_uploaded'));

    // Las que entraron ahora (una investigación agrega varias). Si no hay
    // ninguna nueva, la misma página se agregó dos veces y el servidor devolvió
    // la que ya estaba.
    const nuevas = sourcesApi.sources.filter((fuente) => !antes.has(fuente.id));
    const agregadas = nuevas.length > 0 ? nuevas : sourcesApi.sources.filter((fuente) => fuente.id === documentId);

    void avisarSiElPlanNoLasUsa(agregadas.map((fuente) => fuente.fileName));
  }

  async function avisarSiElPlanNoLasUsa(nombres: string[]) {
    if (nombres.length === 0) return;

    if (planSinTerminar(await leerEstadoDelPlanDelCurso(courseId))) {
      fuentesFueraDelPlan = nombres;
    }
  }

  /**
   * Abre el chat con el pedido escrito, para que la docente lo mande (o lo
   * cambie). Viaja como pedido de cambios al plan: ver `ChatDraft.rehacerPlan`.
   */
  function pedirQueRehagaElPlan() {
    if (!fuentesFueraDelPlan) return;

    setChatDraft({
      text: t.get('course.sources.plan_notice_prompt', {
        count: fuentesFueraDelPlan.length,
        names: fuentesFueraDelPlan.map((nombre) => `"${nombre}"`).join(', ')
      }),
      mode: 'append',
      rehacerPlan: true
    });
    openAiAssistant();
    fuentesFueraDelPlan = null;
  }

  async function handleDelete(documentId: string) {
    const success = await sourcesApi.deleteSource(documentId);
    if (success) {
      snackbar.success(t.get('course.sources.snackbar_deleted'));
    } else if (sourcesApi.error) {
      snackbar.error(t.get('course.sources.snackbar_delete_failed'));
    }
  }

  /**
   * El botón ↻: vuelve a leer la fuente de verdad (el archivo con el lector de
   * hoy, o la página otra vez). «Fuente actualizada» sólo si el texto cambió:
   * antes lo decía siempre, aunque no se hubiera releído nada.
   */
  async function handleRefresh(documentId: string) {
    const relectura = await sourcesApi.releerFuente(documentId);

    if (!relectura) {
      snackbar.error(t.get(claveDelErrorDeFuente(sourcesApi.error, 'course.sources.snackbar_cache_refresh_failed')));
      return;
    }

    if (!relectura.changed) {
      snackbar.info(t.get('course.sources.snackbar_reread_unchanged'));
      return;
    }

    snackbar.success(t.get('course.sources.snackbar_cache_refreshed'));
    // Cambió el texto: cambian las palabras y las páginas que muestra la tarjeta.
    await sourcesApi.listSources(courseId);
  }
</script>

<div class="flex flex-col gap-6">
  <div class="flex items-center justify-between">
    <div class="ui:text-muted-foreground flex items-center gap-3 text-sm">
      <div class="flex items-center gap-2">
        <BookOpenIcon size={14} />
        <span>
          {sourcesApi.sources.length === 0
            ? $t('course.sources.empty_title')
            : $t('course.sources.count', { count: sourcesApi.sources.length })}
        </span>
      </div>
      <!--
        Acá iba "N en caché". Se fue: cuántas fuentes tiene la plataforma
        cacheadas es cómo funciona por dentro, no algo sobre lo que quien arma el
        curso pueda decidir nada. Cada tarjeta ya marca si su fuente fue leída,
        que es la única parte que le sirve.
      -->
      {#if sourcesApi.sources.length > 0 && sourcesApi.reconciling}
        <span class="text-(--border)">·</span>
        <div class="ui:text-primary flex items-center gap-1.5">
          <LoaderIcon size={11} class="animate-spin" />
          <span>{$t('course.sources.reconciling')}</span>
        </div>
      {/if}
    </div>
    <Button onclick={() => (uploadDialogOpen = true)}>
      <PlusIcon size={14} />
      {$t('course.sources.upload_cta')}
    </Button>
  </div>

  {#if fuentesFueraDelPlan}
    <div
      class="flex flex-col gap-3 rounded-lg border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-sm sm:flex-row sm:items-center"
      role="status"
      data-aviso-plan
    >
      <TriangleAlertIcon size={16} class="hidden shrink-0 text-amber-600 sm:block dark:text-amber-400" />
      <p class="min-w-0 flex-1 text-pretty">
        {$t('course.sources.plan_notice', { count: fuentesFueraDelPlan.length })}
      </p>
      <div class="flex shrink-0 gap-2">
        <Button size="sm" variant="ghost" onclick={() => (fuentesFueraDelPlan = null)}>
          {$t('course.sources.plan_notice_dismiss')}
        </Button>
        <Button size="sm" variant="outline" onclick={() => pedirQueRehagaElPlan()}>
          {$t('course.sources.plan_notice_action')}
        </Button>
      </div>
    </div>
  {/if}

  {#if sourcesApi.isLoading && sourcesApi.sources.length === 0}
    <div class="flex items-center justify-center py-12">
      <LoaderIcon size={20} class="ui:text-muted-foreground animate-spin" />
    </div>
  {:else if sourcesApi.sources.length === 0}
    <div class="flex flex-col items-center gap-3 rounded-lg border border-dashed py-12 text-center">
      <BookOpenIcon size={32} class="ui:text-muted-foreground" />
      <h3 class="text-base font-medium">{$t('course.sources.empty_title')}</h3>
      <p class="ui:text-muted-foreground max-w-md text-sm">
        {$t('course.sources.empty_description')}
      </p>
      <Button onclick={() => (uploadDialogOpen = true)} variant="outline">
        <PlusIcon size={14} />
        {$t('course.sources.upload_cta')}
      </Button>
    </div>
  {:else}
    <!--
      Columns sized from the CONTAINER, not the viewport. `md:`/`xl:` breakpoints
      measure the window, so with the assistant panel open the page saw a 1350px
      viewport and laid out three columns inside ~530px of usable width — each
      card ended up ~170px wide, the file name truncated to one letter and the
      metadata wrapped one word per line. `auto-fill` + a 240px minimum drops to
      fewer columns when the panel opens, with no breakpoint to keep in sync.
    -->
    <div class="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
      {#each sourcesApi.sources as source (source.id)}
        <SourceCard
          {source}
          isDeleting={sourcesApi.deletingId === source.id}
          isRefreshing={sourcesApi.refreshingId === source.id}
          cacheStatus={sourcesApi.cacheStatuses[source.id]}
          onDelete={() => handleDelete(source.id)}
          onRefresh={() => handleRefresh(source.id)}
        />
      {/each}
    </div>
  {/if}
</div>

<UploadSourceDialog bind:open={uploadDialogOpen} {courseId} onUploaded={handleUploaded} />
