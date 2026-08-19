<script lang="ts">
  import * as Card from '@cio/ui/base/card';
  import * as Table from '@cio/ui/base/table';
  import { Badge } from '@cio/ui/base/badge';
  import { Empty } from '@cio/ui/custom/empty';
  import { Progress } from '@cio/ui/base/progress';
  import { Spinner } from '@cio/ui/base/spinner';
  import BuildingIcon from '@lucide/svelte/icons/building-2';
  import Trash2Icon from '@lucide/svelte/icons/trash-2';
  import { Button } from '@cio/ui/base/button';
  import { DeleteModal } from '$features/ui';

  import { accountApi } from '$features/account/api/account.svelte';
  import { clientsApi } from '$features/clients/api/clients.svelte';
  import { currentOrg } from '$lib/utils/store/org';
  import { t } from '$lib/utils/functions/translations';

  // Wait for the organization to settle before asking. The API client reads
  // `cio-org-id` off this store, so firing on mount — which is what a direct
  // page load does — sends the request without it and the server rejects it.
  //
  // The same guard the server applies: client companies are listed from the
  // consultancy, so while the store is still passing through one of them there
  // is nothing worth asking for.
  $effect(() => {
    if (!$currentOrg.id || $currentOrg.parentOrganizationId) return;

    clientsApi.loadOverview();
  });

  const overview = $derived(clientsApi.overview);
  const clients = $derived(overview?.clients ?? []);

  function formatNumber(value: number) {
    return new Intl.NumberFormat().format(value);
  }

  /** Clients with nobody enrolled yet read as "—", not as a real 0% of nothing. */
  function progressLabel(client: { studentCount: number; averageProgress: number }) {
    return client.studentCount === 0 ? '—' : `${client.averageProgress}%`;
  }

  /**
   * Borrar vive aca porque es donde se lo busca.
   *
   * Estaba solo en Configuracion → Espacios de trabajo, una tercera pantalla:
   * el operador entraba a "Clientes", que es la lista de sus empresas cliente,
   * y no habia forma de sacar una. La ruta que se usa es la misma de siempre, y
   * el servidor sigue poniendo los limites — solo una empresa hija de esta
   * cuenta, nunca la madre.
   */
  let deleteTarget = $state<{ orgId: string; name: string } | null>(null);
  let isDeleting = $state(false);

  async function confirmDelete() {
    if (!deleteTarget) return;

    isDeleting = true;
    await accountApi.deleteWorkspace(deleteTarget.orgId);
    isDeleting = false;

    if (accountApi.success) {
      deleteTarget = null;
      clientsApi.loadOverview();
    }
  }
</script>

<div class="flex flex-col gap-4">
  {#if clientsApi.isLoading && !overview}
    <div class="flex justify-center py-16"><Spinner class="size-8!" /></div>
  {:else if clients.length === 0}
    <Empty icon={BuildingIcon} title={$t('clients.empty_title')} description={$t('clients.empty_description')} />
  {:else}
    <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Card.Root>
        <Card.Content class="p-4">
          <p class="ui:text-muted-foreground text-xs">{$t('clients.total_clients')}</p>
          <p class="text-2xl font-semibold tabular-nums">{overview?.totals.clientCount ?? 0}</p>
        </Card.Content>
      </Card.Root>
      <Card.Root>
        <Card.Content class="p-4">
          <p class="ui:text-muted-foreground text-xs">{$t('clients.total_students')}</p>
          <p class="text-2xl font-semibold tabular-nums">{formatNumber(overview?.totals.studentCount ?? 0)}</p>
        </Card.Content>
      </Card.Root>
      <Card.Root>
        <Card.Content class="p-4">
          <p class="ui:text-muted-foreground text-xs">{$t('clients.average_progress')}</p>
          <p class="text-2xl font-semibold tabular-nums">{overview?.totals.averageProgress ?? 0}%</p>
        </Card.Content>
      </Card.Root>
      <Card.Root>
        <Card.Content class="p-4">
          <p class="ui:text-muted-foreground text-xs">{$t('clients.account_tokens')}</p>
          <p class="text-2xl font-semibold tabular-nums">
            {formatNumber(overview?.totals.accountTokensThisPeriod ?? 0)}
          </p>
          <p class="ui:text-muted-foreground mt-1 text-xs">
            {$t('clients.account_tokens_split', {
              own: formatNumber(overview?.totals.ownTokensThisPeriod ?? 0)
            })}
          </p>
        </Card.Content>
      </Card.Root>
    </div>

    <Card.Root>
      <Card.Content class="p-0">
        <div class="overflow-x-auto">
          <Table.Root>
            <Table.Header>
              <Table.Row>
                <Table.Head>{$t('clients.col_company')}</Table.Head>
                <Table.Head class="text-right">{$t('clients.col_students')}</Table.Head>
                <Table.Head class="text-right">{$t('clients.col_courses')}</Table.Head>
                <Table.Head class="w-48">{$t('clients.col_progress')}</Table.Head>
                <Table.Head class="text-right">{$t('clients.col_certificates')}</Table.Head>
                <Table.Head class="text-right">{$t('clients.col_not_started')}</Table.Head>
                <Table.Head class="text-right">{$t('clients.col_tokens')}</Table.Head>
                <Table.Head class="w-10"></Table.Head>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {#each clients as client (client.orgId)}
                <Table.Row>
                  <Table.Cell>
                    <div class="flex flex-col">
                      <span class="font-medium">{client.name}</span>
                      {#if client.siteName}
                        <span class="ui:text-muted-foreground text-xs">{client.siteName}</span>
                      {/if}
                    </div>
                  </Table.Cell>
                  <Table.Cell class="text-right tabular-nums">{formatNumber(client.studentCount)}</Table.Cell>
                  <Table.Cell class="text-right tabular-nums">{formatNumber(client.courseCount)}</Table.Cell>
                  <Table.Cell>
                    <div class="flex items-center gap-2">
                      <Progress value={client.averageProgress} class="h-2" />
                      <span class="w-10 text-right text-xs tabular-nums">{progressLabel(client)}</span>
                    </div>
                  </Table.Cell>
                  <Table.Cell class="text-right tabular-nums">{formatNumber(client.certificatesEarned)}</Table.Cell>
                  <Table.Cell class="text-right">
                    {#if client.notStarted > 0}
                      <Badge variant="outline" class="border-amber-500/40 text-amber-600 dark:text-amber-300">
                        {formatNumber(client.notStarted)}
                      </Badge>
                    {:else}
                      <span class="ui:text-muted-foreground text-xs">—</span>
                    {/if}
                  </Table.Cell>
                  <Table.Cell class="text-right tabular-nums">{formatNumber(client.tokensThisPeriod)}</Table.Cell>
                  <Table.Cell class="text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      class="ui:text-muted-foreground hover:ui:text-destructive"
                      aria-label={$t('clients.delete_action')}
                      onclick={() => (deleteTarget = { orgId: client.orgId, name: client.name })}
                    >
                      <Trash2Icon size={16} />
                    </Button>
                  </Table.Cell>
                </Table.Row>
              {/each}
            </Table.Body>
          </Table.Root>
        </div>
      </Card.Content>
    </Card.Root>
  {/if}
</div>

<DeleteModal
  bind:open={() => deleteTarget !== null, (isOpen) => !isOpen && (deleteTarget = null)}
  onDelete={confirmDelete}
  isLoading={isDeleting}
/>
