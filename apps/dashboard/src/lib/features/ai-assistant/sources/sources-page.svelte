<script lang="ts">
  import { sourcesApi } from '../api/sources.svelte';
  import SourceCard from './source-card.svelte';
  import UploadSourceDialog from './upload-source-dialog.svelte';
  import * as Page from '@cio/ui/base/page';
  import { Button } from '@cio/ui/base/button';
  import { t } from '$lib/utils/functions/translations';
  import PlusIcon from '@lucide/svelte/icons/plus';
  import LoaderIcon from '@lucide/svelte/icons/loader';
  import BookOpenIcon from '@lucide/svelte/icons/book-open';
  import { onMount } from 'svelte';
  import { snackbar } from '$features/ui/snackbar/store';

  let { courseId }: { courseId: string } = $props();

  let uploadDialogOpen = $state(false);

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
    await load();
    if (!sourcesApi.error) {
      snackbar.success(t.get('course.sources.snackbar_uploaded'));
    }
  }

  async function handleDelete(documentId: string) {
    const success = await sourcesApi.deleteSource(documentId);
    if (success) {
      snackbar.success(t.get('course.sources.snackbar_deleted'));
    } else if (sourcesApi.error) {
      snackbar.error(t.get('course.sources.snackbar_delete_failed'));
    }
  }

  async function handleRefresh(documentId: string) {
    const status = await sourcesApi.refreshCache(documentId);
    if (status) {
      snackbar.success(t.get('course.sources.snackbar_cache_refreshed'));
    } else if (sourcesApi.error) {
      snackbar.error(t.get('course.sources.snackbar_cache_refresh_failed'));
    }
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
        <span class="ui:text-border">·</span>
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
