<script lang="ts">
  import * as Dialog from '@cio/ui/base/dialog';
  import * as Item from '@cio/ui/base/item';
  import * as Page from '@cio/ui/base/page';
  import { Button } from '@cio/ui/base/button';
  import { Empty } from '@cio/ui/custom/empty';
  import VideoIcon from '@lucide/svelte/icons/video';

  import type { TAssetUpdate } from '@cio/utils/validation/assets';

  import {
    AssetCard,
    AssetUsageDialog,
    EditAssetDialog,
    ManageThumbnailsDialog,
    MediaFilters,
    StorageCards
  } from '$features/media/components';
  import { mediaApi } from '$features/media/api';
  import {
    getAssetDisplayName,
    type AssetKindFilter,
    type AssetStatusFilter,
    type AssetUsageGraph,
    type OrganizationAsset
  } from '$features/media/utils';
  import { snackbar } from '$features/ui/snackbar/store';
  import { t } from '$lib/utils/functions/translations';

  interface Props {
    search?: string;
    kind?: AssetKindFilter;
    status?: AssetStatusFilter;
  }

  let {
    search = $bindable(''),
    kind = $bindable('all' as AssetKindFilter),
    status = $bindable('all' as AssetStatusFilter)
  }: Props = $props();

  let isRefreshing = $state(false);
  let editOpen = $state(false);
  let usageOpen = $state(false);
  let manageThumbsOpen = $state(false);
  let isSavingAsset = $state(false);
  let isUsageLoading = $state(false);
  let downloadingAssetId = $state<string | null>(null);
  let selectedAsset = $state<OrganizationAsset | null>(null);
  let usageData = $state<AssetUsageGraph | null>(null);
  let deleteOpen = $state(false);
  let isDeletingAsset = $state(false);
  let assetToDelete = $state<OrganizationAsset | null>(null);
  let deleteUsage = $state<AssetUsageGraph | null>(null);
  let isDeleteUsageLoading = $state(false);

  const assets = $derived(mediaApi.assets);
  const storageSummary = $derived(mediaApi.storageSummary);
  const pagination = $derived(mediaApi.pagination);

  async function refreshAssets(page = 1) {
    isRefreshing = true;
    try {
      await mediaApi.listAssets({
        page,
        limit: pagination?.limit ?? 20,
        search: search.trim() || undefined,
        kind: kind === 'all' ? undefined : kind,
        status: status === 'all' ? undefined : status
      });
    } finally {
      isRefreshing = false;
    }
  }

  async function refreshStorageSummary() {
    await mediaApi.getStorageSummary();
  }

  async function refreshMediaData() {
    await Promise.all([refreshAssets(1), refreshStorageSummary()]);
  }

  function openEditAsset(asset: OrganizationAsset) {
    selectedAsset = asset;
    editOpen = true;
  }

  function openManageThumbnails(asset: OrganizationAsset) {
    selectedAsset = asset;
    manageThumbsOpen = true;
  }

  async function saveAsset(fields: TAssetUpdate) {
    if (!selectedAsset) return;

    isSavingAsset = true;
    try {
      const updated = await mediaApi.updateAsset(selectedAsset.id, fields);
      if (!updated) return;

      selectedAsset = updated;
      editOpen = false;
      snackbar.success('snackbar.media_manager.update_success');
      await refreshStorageSummary();
    } finally {
      isSavingAsset = false;
    }
  }

  async function openUsage(asset: OrganizationAsset) {
    selectedAsset = asset;
    usageOpen = true;
    isUsageLoading = true;
    usageData = null;
    try {
      usageData = await mediaApi.getAssetUsage(asset.id);
    } finally {
      isUsageLoading = false;
    }
  }

  function resetUsageModalState() {
    selectedAsset = null;
    usageData = null;
    isUsageLoading = false;
  }

  async function downloadAsset(asset: OrganizationAsset) {
    downloadingAssetId = asset.id;
    try {
      const url = await mediaApi.getAssetDownloadUrl(asset);
      if (!url) {
        snackbar.error('snackbar.media_manager.download_failed');
        return;
      }
      window.open(url, '_blank', 'noopener,noreferrer');
    } finally {
      downloadingAssetId = null;
    }
  }

  /**
   * Los primeros cursos donde el medio esta puesto, sin repetir.
   *
   * Se muestran 3: alcanzan para reconocer de que se trata, y una lista larga
   * dentro de un cartel de confirmacion se deja de leer.
   */
  const CURSOS_A_MOSTRAR = 3;

  const cursosQueLoUsan = $derived.by(() => {
    const titulos = (deleteUsage?.usages ?? [])
      .map((uso) => uso.courseTitle)
      .filter((titulo): titulo is string => Boolean(titulo));

    return [...new Set(titulos)];
  });

  const estaEnUso = $derived((deleteUsage?.usageCount ?? 0) > 0);

  async function askDeleteAsset(asset: OrganizationAsset) {
    assetToDelete = asset;
    deleteUsage = null;
    deleteOpen = true;

    // Se consulta ANTES de que confirme, no despues de que falle: el aviso solo
    // sirve si llega a tiempo para cambiar la decision.
    isDeleteUsageLoading = true;
    try {
      deleteUsage = await mediaApi.getAssetUsage(asset.id);
    } finally {
      isDeleteUsageLoading = false;
    }
  }

  async function confirmDeleteAsset() {
    if (!assetToDelete) return;

    isDeletingAsset = true;
    try {
      // Si esta en uso, la persona ya vio donde: forzar es su decision, tomada
      // con el dato a la vista.
      const borrado = await mediaApi.deleteAsset(assetToDelete.id, { force: estaEnUso });
      if (!borrado) return;

      deleteOpen = false;
      assetToDelete = null;
      deleteUsage = null;
      snackbar.success('snackbar.media_manager.delete_success');
      // El resumen de almacenamiento cambia con cada borrado; sin esto la
      // pantalla sigue diciendo que ocupa lo mismo que antes.
      await Promise.all([refreshAssets(pagination?.page ?? 1), refreshStorageSummary()]);
    } finally {
      isDeletingAsset = false;
    }
  }

  function handleUsageOpenChange(isOpen: boolean) {
    if (!isOpen) {
      resetUsageModalState();
    }
  }

  const prevPage = $derived(Math.max(1, (pagination?.page ?? 1) - 1));
  const nextPage = $derived((pagination?.page ?? 1) + 1);
</script>

<StorageCards {storageSummary} />

<Page.BodyHeader class="flex-col flex-wrap! items-start! gap-3 lg:flex-row">
  <MediaFilters
    bind:search
    bind:kind
    bind:status
    {isRefreshing}
    onApply={() => refreshAssets(1)}
    onRefresh={refreshMediaData}
  />
</Page.BodyHeader>

{#if assets.length === 0}
  <Empty
    title={$t('media_manager.empty')}
    description={$t('media_manager.empty_description')}
    icon={VideoIcon}
    variant="page"
  />
{:else}
  <Item.Group class="grid! w-full grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
    {#each assets as asset (asset.id)}
      <AssetCard
        {asset}
        {downloadingAssetId}
        onEdit={openEditAsset}
        onUsage={openUsage}
        onDownload={downloadAsset}
        onManageThumbnails={openManageThumbnails}
        onDelete={askDeleteAsset}
      />
    {/each}
  </Item.Group>
{/if}

{#if pagination && pagination.totalPages > 1}
  <div class="flex items-center justify-end gap-2">
    <Button
      variant="outline"
      size="sm"
      disabled={isRefreshing || (pagination?.page ?? 1) <= 1}
      onclick={() => refreshAssets(prevPage)}
    >
      {$t('media_manager.pagination.previous')}
    </Button>
    <p class="ui:text-muted-foreground text-sm">
      {$t('media_manager.pagination.page')}
      {pagination.page}
      / {pagination.totalPages}
    </p>
    <Button
      variant="outline"
      size="sm"
      disabled={isRefreshing || (pagination?.page ?? 1) >= pagination.totalPages}
      onclick={() => refreshAssets(nextPage)}
    >
      {$t('media_manager.pagination.next')}
    </Button>
  </div>
{/if}

<EditAssetDialog bind:open={editOpen} asset={selectedAsset} isSaving={isSavingAsset} onSave={saveAsset} />

<ManageThumbnailsDialog bind:open={manageThumbsOpen} asset={selectedAsset} />

<AssetUsageDialog
  bind:open={usageOpen}
  {selectedAsset}
  {usageData}
  isLoading={isUsageLoading}
  onOpenChange={handleUsageOpenChange}
/>

<!--
  Borrar es definitivo y la tarjeta esta a un clic del menu, asi que va con
  confirmacion y con el nombre del archivo adentro: "¿seguro?" a secas no dice
  cual, y en una grilla de medios parecidos eso es justo lo que hace falta saber.
-->
<Dialog.Root bind:open={deleteOpen}>
  <Dialog.Content size="sm">
    <Dialog.Header>
      <Dialog.Title>{$t('media_manager.delete_confirm.title')}</Dialog.Title>
      <Dialog.Description>
        {$t('media_manager.delete_confirm.body', { name: assetToDelete ? getAssetDisplayName(assetToDelete) : '' })}
      </Dialog.Description>
    </Dialog.Header>

    {#if isDeleteUsageLoading}
      <p class="ui:text-muted-foreground text-sm">{$t('media_manager.delete_confirm.checking')}</p>
    {:else if estaEnUso}
      <!--
        El aviso nombra los cursos. El bloqueo anterior decia "todavia se usa" y
        nada mas, asi que quien estaba seguro de haberlo sacado no tenia como
        comprobar quien de los dos se equivocaba.
      -->
      <div class="ui:border-destructive/40 ui:bg-destructive/5 rounded-md border p-3">
        <p class="text-sm font-medium">{$t('media_manager.delete_confirm.in_use_title')}</p>
        <ul class="ui:text-muted-foreground mt-2 list-disc space-y-1 pl-5 text-sm">
          {#each cursosQueLoUsan.slice(0, CURSOS_A_MOSTRAR) as curso (curso)}
            <li>{curso}</li>
          {/each}
        </ul>
        {#if cursosQueLoUsan.length > CURSOS_A_MOSTRAR}
          <p class="ui:text-muted-foreground mt-2 text-xs">
            {$t('media_manager.delete_confirm.more_courses', { count: cursosQueLoUsan.length - CURSOS_A_MOSTRAR })}
          </p>
        {:else if cursosQueLoUsan.length === 0}
          <!-- Puesto en algo que no es una leccion de un curso: se dice el cuanto,
               que es lo unico cierto, en vez de inventar un nombre. -->
          <p class="ui:text-muted-foreground mt-2 text-sm">
            {$t('media_manager.delete_confirm.in_use_unknown', { count: deleteUsage?.usageCount ?? 0 })}
          </p>
        {/if}
        <p class="mt-3 text-sm">{$t('media_manager.delete_confirm.in_use_warning')}</p>
      </div>
    {/if}

    <Dialog.Footer>
      <Button variant="outline" disabled={isDeletingAsset} onclick={() => (deleteOpen = false)}>
        {$t('media_manager.delete_confirm.cancel')}
      </Button>
      <Button
        variant="destructive"
        disabled={isDeletingAsset || isDeleteUsageLoading}
        onclick={confirmDeleteAsset}
      >
        {estaEnUso
          ? $t('media_manager.delete_confirm.confirm_anyway')
          : $t('media_manager.delete_confirm.confirm')}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
