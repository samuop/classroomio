<script lang="ts">
  import * as Card from '@cio/ui/base/card';
  import * as Table from '@cio/ui/base/table';
  import * as Dialog from '@cio/ui/base/dialog';
  import * as Field from '@cio/ui/base/field';
  import * as DropdownMenu from '@cio/ui/base/dropdown-menu';
  import { Badge } from '@cio/ui/base/badge';
  import { Button } from '@cio/ui/base/button';
  import { Input } from '@cio/ui/base/input';
  import { Spinner } from '@cio/ui/base/spinner';
  import { Empty } from '@cio/ui/custom/empty';
  import BuildingIcon from '@lucide/svelte/icons/building-2';
  import SearchIcon from '@lucide/svelte/icons/search';
  import MoreVerticalIcon from '@lucide/svelte/icons/more-vertical';

  import { platformApi } from '$features/platform/api/platform.svelte';
  import OrganizationDetail from '$features/platform/components/organization-detail.svelte';
  import type { PlatformOrg, PlatformOrgSortBy, PlatformPlanName } from '$features/platform/utils/types';
  import { t } from '$lib/utils/functions/translations';

  let searchTerm = $state('');
  let sortBy = $state<PlatformOrgSortBy>('createdAt');
  let sortOrder = $state<'asc' | 'desc'>('desc');

  // Create dialog
  let isCreateOpen = $state(false);
  let createName = $state('');
  let createSiteName = $state('');
  let createOwnerEmail = $state('');
  let createOwnerName = $state('');
  let createOwnerPassword = $state('');
  let createPlan = $state<PlatformPlanName>('ENTERPRISE');

  const PLAN_OPTIONS: { value: PlatformPlanName; labelKey: string }[] = [
    { value: 'BASIC', labelKey: 'platform.plans.basic' },
    { value: 'EARLY_ADOPTER', labelKey: 'platform.plans.early_adopter' },
    { value: 'ENTERPRISE', labelKey: 'platform.plans.enterprise' }
  ];

  // Rename dialog
  let renameTarget = $state<PlatformOrg | null>(null);
  let renameValue = $state('');

  // Suspend confirmation
  let suspendTarget = $state<{ org: PlatformOrg; suspend: boolean } | null>(null);

  // Detail drawer
  let detailOrgId = $state<string | null>(null);

  let searchTimer: ReturnType<typeof setTimeout>;

  $effect(() => {
    platformApi.listOrganizations({ sortBy, sortOrder });
  });

  const organizations = $derived(platformApi.organizations);
  const pagination = $derived(platformApi.pagination);

  function onSearchInput(value: string) {
    searchTerm = value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      platformApi.listOrganizations({ search: value.trim() || undefined, sortBy, sortOrder });
    }, 350);
  }

  function toggleSort(column: PlatformOrgSortBy) {
    if (sortBy === column) {
      sortOrder = sortOrder === 'asc' ? 'desc' : 'asc';
    } else {
      sortBy = column;
      sortOrder = column === 'name' ? 'asc' : 'desc';
    }
  }

  function sortIndicator(column: PlatformOrgSortBy) {
    if (sortBy !== column) return '';
    return sortOrder === 'asc' ? '↑' : '↓';
  }

  function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function formatTokens(tokens: number) {
    return new Intl.NumberFormat().format(tokens);
  }

  /**
   * Readable rather than maximally random: the operator has to relay it to the
   * client by hand, and it is replaced on first sign-in anyway.
   */
  function generatePassword() {
    const alphabet = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const bytes = crypto.getRandomValues(new Uint8Array(14));
    createOwnerPassword = Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
  }

  async function onCreate() {
    await platformApi.createOrganization({
      orgName: createName,
      siteName: createSiteName,
      ownerEmail: createOwnerEmail,
      planName: createPlan,
      ...(createOwnerName.trim() ? { ownerName: createOwnerName.trim() } : {}),
      ...(createOwnerPassword ? { ownerPassword: createOwnerPassword } : {})
    });

    if (platformApi.success) {
      createName = '';
      createSiteName = '';
      createOwnerEmail = '';
      createOwnerName = '';
      createOwnerPassword = '';
      createPlan = 'ENTERPRISE';
      isCreateOpen = false;
    }
  }

  function openRename(org: PlatformOrg) {
    renameTarget = org;
    renameValue = org.name;
  }

  async function onRename() {
    if (!renameTarget) return;

    await platformApi.renameOrganization(renameTarget.id, renameValue.trim());
    if (platformApi.success) renameTarget = null;
  }

  async function onConfirmSuspend() {
    if (!suspendTarget) return;

    await platformApi.setSuspension(suspendTarget.org.id, suspendTarget.suspend);
    suspendTarget = null;
  }
</script>

<div class="flex flex-col gap-4">
  <div class="flex flex-wrap items-center justify-between gap-3">
    <div class="relative w-full max-w-xs">
      <SearchIcon class="ui:text-muted-foreground pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2" />
      <Input
        value={searchTerm}
        oninput={(e) => onSearchInput(e.currentTarget.value)}
        placeholder={$t('platform.orgs.search_placeholder')}
        class="pl-9"
      />
    </div>

    <Button onclick={() => (isCreateOpen = true)}>{$t('platform.orgs.create_cta')}</Button>
  </div>

  <Card.Root>
    <Card.Content class="p-0">
      {#if platformApi.isLoading && organizations.length === 0}
        <div class="flex justify-center py-16">
          <Spinner class="size-8!" />
        </div>
      {:else if organizations.length === 0}
        <Empty icon={BuildingIcon} title={$t('platform.orgs.empty')} />
      {:else}
        <Table.Root>
          <Table.Header>
            <Table.Row>
              <Table.Head>
                <button class="font-medium hover:underline" onclick={() => toggleSort('name')}>
                  {$t('platform.orgs.col_name')}
                  {sortIndicator('name')}
                </button>
              </Table.Head>
              <Table.Head>{$t('platform.orgs.col_plan')}</Table.Head>
              <Table.Head class="text-right">
                <button class="font-medium hover:underline" onclick={() => toggleSort('tokens')}>
                  {$t('platform.orgs.col_tokens')}
                  {sortIndicator('tokens')}
                </button>
              </Table.Head>
              <Table.Head class="text-right">{$t('platform.orgs.col_members')}</Table.Head>
              <Table.Head>{$t('platform.orgs.col_status')}</Table.Head>
              <Table.Head>
                <button class="font-medium hover:underline" onclick={() => toggleSort('createdAt')}>
                  {$t('platform.orgs.col_created')}
                  {sortIndicator('createdAt')}
                </button>
              </Table.Head>
              <Table.Head class="w-10"></Table.Head>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {#each organizations as org (org.id)}
              <Table.Row>
                <Table.Cell>
                  <div class="flex flex-col">
                    <span class="font-medium">{org.name}</span>
                    {#if org.siteName}
                      <span class="ui:text-muted-foreground text-xs">{org.siteName}</span>
                    {/if}
                  </div>
                </Table.Cell>
                <Table.Cell>
                  {#if org.planName}
                    <Badge variant="secondary">{org.planName}</Badge>
                  {:else}
                    <span class="ui:text-muted-foreground text-xs">{$t('platform.orgs.no_plan')}</span>
                  {/if}
                </Table.Cell>
                <Table.Cell class="text-right tabular-nums">{formatTokens(org.tokensThisPeriod)}</Table.Cell>
                <Table.Cell class="text-right tabular-nums">{org.memberCount}</Table.Cell>
                <Table.Cell>
                  {#if org.isRestricted}
                    <Badge variant="outline" class="border-rose-500/40 text-rose-600 dark:text-rose-300">
                      {$t('platform.orgs.status_suspended')}
                    </Badge>
                  {:else}
                    <Badge variant="outline" class="border-emerald-500/40 text-emerald-600 dark:text-emerald-300">
                      {$t('platform.orgs.status_active')}
                    </Badge>
                  {/if}
                </Table.Cell>
                <Table.Cell class="ui:text-muted-foreground text-sm">{formatDate(org.createdAt)}</Table.Cell>
                <Table.Cell>
                  <DropdownMenu.Root>
                    <DropdownMenu.Trigger>
                      {#snippet child({ props })}
                        <Button {...props} variant="ghost" size="icon" class="size-8">
                          <MoreVerticalIcon class="size-4" />
                        </Button>
                      {/snippet}
                    </DropdownMenu.Trigger>
                    <DropdownMenu.Content align="end">
                      <DropdownMenu.Item onclick={() => (detailOrgId = org.id)}>
                        {$t('platform.orgs.action_detail')}
                      </DropdownMenu.Item>
                      <DropdownMenu.Item onclick={() => openRename(org)}>
                        {$t('platform.orgs.action_rename')}
                      </DropdownMenu.Item>
                      {#if org.isRestricted}
                        <DropdownMenu.Item onclick={() => (suspendTarget = { org, suspend: false })}>
                          {$t('platform.orgs.action_reactivate')}
                        </DropdownMenu.Item>
                      {:else}
                        <DropdownMenu.Item
                          class="text-rose-600"
                          onclick={() => (suspendTarget = { org, suspend: true })}
                        >
                          {$t('platform.orgs.action_suspend')}
                        </DropdownMenu.Item>
                      {/if}
                    </DropdownMenu.Content>
                  </DropdownMenu.Root>
                </Table.Cell>
              </Table.Row>
            {/each}
          </Table.Body>
        </Table.Root>
      {/if}
    </Card.Content>
  </Card.Root>

  {#if pagination && pagination.total > 0}
    <p class="ui:text-muted-foreground text-sm">
      {$t('platform.orgs.total_count', { count: pagination.total })}
    </p>
  {/if}
</div>

<!-- Create -->
<Dialog.Root bind:open={isCreateOpen}>
  <Dialog.Content class="ui:flex ui:max-h-[85vh] ui:flex-col ui:overflow-hidden">
    <Dialog.Header>
      <Dialog.Title>{$t('platform.orgs.create_title')}</Dialog.Title>
      <Dialog.Description>{$t('platform.orgs.create_description')}</Dialog.Description>
    </Dialog.Header>

    <div class="ui:-mr-2 ui:min-h-0 ui:flex-1 ui:overflow-y-auto ui:pr-2">
      <Field.Group>
      <Field.Field>
        <Field.Label>{$t('platform.orgs.name_label')}</Field.Label>
        <Input bind:value={createName} />
        {#if platformApi.errors.orgName}
          <Field.Error>{platformApi.errors.orgName}</Field.Error>
        {/if}
      </Field.Field>

      <Field.Field>
        <Field.Label>{$t('platform.orgs.site_name_label')}</Field.Label>
        <Input bind:value={createSiteName} />
        {#if platformApi.errors.siteName}
          <Field.Error>{platformApi.errors.siteName}</Field.Error>
        {/if}
      </Field.Field>

      <Field.Field>
        <Field.Label>{$t('platform.orgs.owner_email_label')}</Field.Label>
        <Input bind:value={createOwnerEmail} type="email" />
        <Field.Description>{$t('platform.orgs.owner_email_hint')}</Field.Description>
        {#if platformApi.errors.ownerEmail}
          <Field.Error>{platformApi.errors.ownerEmail}</Field.Error>
        {/if}
      </Field.Field>

      <Field.Field>
        <Field.Label>{$t('platform.orgs.owner_name_label')}</Field.Label>
        <Input bind:value={createOwnerName} />
      </Field.Field>

      <Field.Field>
        <Field.Label>{$t('platform.orgs.owner_password_label')}</Field.Label>
        <div class="flex gap-2">
          <Input bind:value={createOwnerPassword} autocomplete="off" />
          <Button variant="outline" onclick={generatePassword}>{$t('platform.orgs.owner_password_generate')}</Button>
        </div>
        <Field.Description>{$t('platform.orgs.owner_password_hint')}</Field.Description>
        {#if platformApi.errors.ownerPassword}
          <Field.Error>{platformApi.errors.ownerPassword}</Field.Error>
        {/if}
      </Field.Field>

      <Field.Field>
        <Field.Label>{$t('platform.orgs.plan_label')}</Field.Label>
        <div class="grid grid-cols-3 gap-2">
          {#each PLAN_OPTIONS as option (option.value)}
            <Button
              variant={createPlan === option.value ? 'default' : 'outline'}
              size="sm"
              onclick={() => (createPlan = option.value)}
            >
              {$t(option.labelKey)}
            </Button>
          {/each}
        </div>
      </Field.Field>
      </Field.Group>
    </div>

    <Dialog.Footer>
      <Button variant="outline" onclick={() => (isCreateOpen = false)}>{$t('platform.orgs.cancel')}</Button>
      <Button onclick={onCreate} loading={platformApi.isLoading} disabled={platformApi.isLoading}>
        {$t('platform.orgs.create_submit')}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

<!-- Rename -->
<Dialog.Root open={renameTarget !== null} onOpenChange={(open) => !open && (renameTarget = null)}>
  <Dialog.Content>
    <Dialog.Header>
      <Dialog.Title>{$t('platform.orgs.rename_title')}</Dialog.Title>
    </Dialog.Header>

    <Field.Field>
      <Field.Label>{$t('platform.orgs.name_label')}</Field.Label>
      <Input bind:value={renameValue} />
    </Field.Field>

    <Dialog.Footer>
      <Button variant="outline" onclick={() => (renameTarget = null)}>{$t('platform.orgs.cancel')}</Button>
      <Button onclick={onRename} loading={platformApi.isLoading} disabled={platformApi.isLoading || !renameValue.trim()}>
        {$t('platform.orgs.rename_submit')}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

<!-- Suspend / reactivate -->
<Dialog.Root open={suspendTarget !== null} onOpenChange={(open) => !open && (suspendTarget = null)}>
  <Dialog.Content>
    <Dialog.Header>
      <Dialog.Title>
        {suspendTarget?.suspend ? $t('platform.orgs.suspend_title') : $t('platform.orgs.reactivate_title')}
      </Dialog.Title>
    </Dialog.Header>
    <p class="ui:text-muted-foreground">
      {suspendTarget?.suspend
        ? $t('platform.orgs.suspend_body', { name: suspendTarget?.org.name ?? '' })
        : $t('platform.orgs.reactivate_body', { name: suspendTarget?.org.name ?? '' })}
    </p>
    <Dialog.Footer>
      <Button variant="outline" onclick={() => (suspendTarget = null)}>{$t('platform.orgs.cancel')}</Button>
      <Button
        variant={suspendTarget?.suspend ? 'destructive' : 'default'}
        onclick={onConfirmSuspend}
        loading={platformApi.isLoading}
        disabled={platformApi.isLoading}
      >
        {suspendTarget?.suspend ? $t('platform.orgs.action_suspend') : $t('platform.orgs.action_reactivate')}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

<!-- Detail + domains -->
<OrganizationDetail orgId={detailOrgId} onClose={() => (detailOrgId = null)} />
