<script lang="ts">
  import * as Avatar from '@cio/ui/base/avatar';
  import * as Sidebar from '@cio/ui/base/sidebar';
  import * as Breadcrumb from '@cio/ui/base/breadcrumb';
  import PlusIcon from '@lucide/svelte/icons/plus';
  import { Skeleton } from '@cio/ui/base/skeleton';
  import { useSidebar } from '@cio/ui/base/sidebar';
  import * as DropdownMenu from '@cio/ui/base/dropdown-menu';
  import ChevronsUpDownIcon from '@lucide/svelte/icons/chevrons-up-down';
  import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
  import { shortenName } from '$lib/utils/functions/string';
  import type { AccountOrg } from '$features/app/types';

  import { setTheme } from '$lib/utils/functions/theme';
  import {
    currentOrg,
    currentOrgPath,
    mergeAccountOrgFromServer,
    orgBrand,
    orgs,
    type OrgBrand
  } from '$lib/utils/store/org';
  import { t } from '$lib/utils/functions/translations';

  import ComingSoon from '$features/ui/coming-soon.svelte';
  import { PUBLIC_IS_SELFHOSTED } from '$env/static/public';

  const sidebar = useSidebar();
  const isSelfHosted = PUBLIC_IS_SELFHOSTED === 'true';

  interface Props {
    variant?: 'sidebar' | 'breadcrumb';
  }

  let { variant = 'sidebar' }: Props = $props();

  function rootIdFor(org: Pick<AccountOrg, 'id' | 'parentOrganizationId'>): string {
    return org.parentOrganizationId ?? org.id;
  }

  const accountRootId = $derived(rootIdFor($currentOrg));

  const accountWorkspaces = $derived($orgs.filter((org) => rootIdFor(org) === accountRootId));
  const otherOrgs = $derived($orgs.filter((org) => rootIdFor(org) !== accountRootId));

  /**
   * Cómo se ve cada empresa en el selector.
   *
   * Quien tiene a la madre en su lista es el equipo de la consultora: necesita
   * distinguir a sus clientes, así que los ve con su nombre real. El resto —la
   * gente del cliente— ve la marca con que el cliente se presenta (`orgBrand`),
   * igual que en todo el resto de la plataforma.
   */
  function shown(org: AccountOrg): OrgBrand {
    const esDelEquipoDeLaConsultora =
      Boolean(org.parentOrganizationId) && $orgs.some((other) => other.id === org.parentOrganizationId);

    return orgBrand(esDelEquipoDeLaConsultora ? { ...org, brand: null } : org);
  }

  const currentShown = $derived(shown($currentOrg));

  function onClick(org: AccountOrg) {
    if (org.id === $currentOrg.id) return;

    localStorage.setItem('classroomio_org_sitename', org.siteName!);
    currentOrg.set(mergeAccountOrgFromServer(org));

    setTheme(orgBrand(org).theme);
    window.location.href = $currentOrgPath;
  }
</script>

{#if isSelfHosted}
  <!-- Self-hosted: show org name only, no switching -->
  {#if variant === 'breadcrumb'}
    <Breadcrumb.Link href={$currentOrgPath} class="flex items-center gap-2">
      {#if currentShown.name}
        <Avatar.Root class="flex size-6! items-center justify-center rounded-md!">
          <Avatar.Image src={currentShown.avatarUrl} alt={currentShown.name} />
          <Avatar.Fallback class="rounded-md! text-xs">{shortenName(currentShown.name)}</Avatar.Fallback>
        </Avatar.Root>
        <span class="hidden truncate text-sm font-medium md:block">{currentShown.name}</span>
      {:else}
        <Skeleton class="h-4 w-24" />
      {/if}
    </Breadcrumb.Link>
  {:else}
    <Sidebar.Menu>
      <Sidebar.MenuItem>
        <div class="flex items-center gap-3 px-2 py-1.5">
          {#if currentShown.name}
            <Avatar.Root class="ui:flex ui:size-8 ui:items-center ui:justify-center ui:rounded-lg">
              <Avatar.Image src={currentShown.avatarUrl} alt={currentShown.name} />
              <Avatar.Fallback class="rounded-lg">{shortenName(currentShown.name)}</Avatar.Fallback>
            </Avatar.Root>
            <div class="grid flex-1 text-left text-sm leading-tight">
              <span class="truncate font-normal">{currentShown.name}</span>
              <span class="truncate text-xs">{$currentOrg.plans?.[0]?.planName || 'Free'}</span>
            </div>
          {:else}
            <Skeleton class="h-full w-full" />
          {/if}
        </div>
      </Sidebar.MenuItem>
    </Sidebar.Menu>
  {/if}
{:else if variant === 'breadcrumb'}
  <!-- Breadcrumb context version -->
  <DropdownMenu.Root>
    <DropdownMenu.Trigger>
      {#snippet child({ props })}
        <Breadcrumb.Link {...props} href="##" class="flex items-center gap-2">
          {#if currentShown.name}
            <Avatar.Root class="flex size-6! items-center justify-center rounded-md!">
              <Avatar.Image src={currentShown.avatarUrl} alt={currentShown.name} />
              <Avatar.Fallback class="rounded-md! text-xs">{shortenName(currentShown.name)}</Avatar.Fallback>
            </Avatar.Root>
            <span class="hidden truncate text-sm font-medium md:block">{currentShown.name}</span>
            <ChevronDownIcon class="ml-auto hidden size-4 md:block" />
          {:else}
            <Skeleton class="h-4 w-24" />
          {/if}
        </Breadcrumb.Link>
      {/snippet}
    </DropdownMenu.Trigger>
    <DropdownMenu.Content
      class="ui:w-(--bits-dropdown-menu-anchor-width) ui:min-w-56 ui:rounded-lg"
      align="start"
      side={sidebar.isMobile ? 'bottom' : 'right'}
      sideOffset={4}
    >
      <DropdownMenu.Label class="ui:text-muted-foreground ui:text-xs"
        >{$t('account.switcher.your_account')}</DropdownMenu.Label
      >

      {#each accountWorkspaces as org (org.id)}
        <DropdownMenu.Item onSelect={() => onClick(org)} class="gap-2 p-2">
          <Avatar.Root class="flex size-8 items-center justify-center rounded-lg">
            <Avatar.Image src={shown(org).avatarUrl} alt={shown(org).name} />
            <Avatar.Fallback class="rounded-lg">{shortenName(shown(org).name)}</Avatar.Fallback>
          </Avatar.Root>

          {shown(org).name}
        </DropdownMenu.Item>
      {/each}

      {#if otherOrgs.length > 0}
        <DropdownMenu.Separator />
        <DropdownMenu.Label class="ui:text-muted-foreground ui:text-xs"
          >{$t('account.switcher.other_organizations')}</DropdownMenu.Label
        >
        {#each otherOrgs as org (org.id)}
          <DropdownMenu.Item onSelect={() => onClick(org)} class="gap-2 p-2">
            <Avatar.Root class="flex size-8 items-center justify-center rounded-lg">
              <Avatar.Image src={shown(org).avatarUrl} alt={shown(org).name} />
              <Avatar.Fallback class="rounded-lg">{shortenName(shown(org).name)}</Avatar.Fallback>
            </Avatar.Root>

            {shown(org).name}
          </DropdownMenu.Item>
        {/each}
      {/if}

      <DropdownMenu.Separator />

      <DropdownMenu.Item class="cursor-not-allowed gap-2 p-2 opacity-50">
        <div class="flex size-6 items-center justify-center rounded-md border bg-transparent">
          <PlusIcon class="size-4" />
        </div>
        <div class="ui:text-muted-foreground ui:font-normal">Add Organization</div>

        <ComingSoon />
      </DropdownMenu.Item>
    </DropdownMenu.Content>
  </DropdownMenu.Root>
{:else}
  <!-- Sidebar context version -->
  <Sidebar.Menu>
    <Sidebar.MenuItem>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger>
          {#snippet child({ props })}
            <Sidebar.MenuButton
              {...props}
              size="lg"
              class="ui:data-[state=open]:bg-sidebar-accent ui:data-[state=open]:text-sidebar-accent-foreground"
            >
              {#if currentShown.name}
                <Avatar.Root class="ui:flex ui:size-8 ui:items-center ui:justify-center ui:rounded-lg">
                  <Avatar.Image src={currentShown.avatarUrl} alt={currentShown.name} />
                  <Avatar.Fallback class="rounded-lg">{shortenName(currentShown.name)}</Avatar.Fallback>
                </Avatar.Root>

                <div class="grid flex-1 text-left text-sm leading-tight">
                  <span class="truncate font-normal">
                    {currentShown.name}
                  </span>
                  <span class="truncate text-xs">
                    {$currentOrg.plans?.[0]?.planName || 'Free'}
                  </span>
                </div>
                <ChevronsUpDownIcon class="ml-auto" />
              {:else}
                <div class="h-[30px] w-[219px]">
                  <Skeleton class="h-full w-full" />
                </div>
              {/if}
            </Sidebar.MenuButton>
          {/snippet}
        </DropdownMenu.Trigger>
        <DropdownMenu.Content
          class="ui:w-(--bits-dropdown-menu-anchor-width) ui:min-w-56 ui:rounded-lg"
          align="start"
          side={sidebar.isMobile ? 'bottom' : 'right'}
          sideOffset={4}
        >
          <DropdownMenu.Label class="ui:text-muted-foreground ui:text-xs"
            >{$t('account.switcher.your_account')}</DropdownMenu.Label
          >

          {#each accountWorkspaces as org (org.id)}
            <DropdownMenu.Item onSelect={() => onClick(org)} class="gap-2 p-2">
              <Avatar.Root class="flex size-8 items-center justify-center rounded-lg">
                <Avatar.Image src={shown(org).avatarUrl} alt={shown(org).name} />
                <Avatar.Fallback class="rounded-lg">{shortenName(shown(org).name)}</Avatar.Fallback>
              </Avatar.Root>

              {shown(org).name}
            </DropdownMenu.Item>
          {/each}

          {#if otherOrgs.length > 0}
            <DropdownMenu.Separator />
            <DropdownMenu.Label class="ui:text-muted-foreground ui:text-xs"
              >{$t('account.switcher.other_organizations')}</DropdownMenu.Label
            >
            {#each otherOrgs as org (org.id)}
              <DropdownMenu.Item onSelect={() => onClick(org)} class="gap-2 p-2">
                <Avatar.Root class="flex size-8 items-center justify-center rounded-lg">
                  <Avatar.Image src={shown(org).avatarUrl} alt={shown(org).name} />
                  <Avatar.Fallback class="rounded-lg">{shortenName(shown(org).name)}</Avatar.Fallback>
                </Avatar.Root>

                {shown(org).name}
              </DropdownMenu.Item>
            {/each}
          {/if}

          <DropdownMenu.Separator />

          <DropdownMenu.Item class="cursor-not-allowed gap-2 p-2 opacity-50">
            <div class="flex size-6 items-center justify-center rounded-md border bg-transparent">
              <PlusIcon class="size-4" />
            </div>
            <div class="ui:text-muted-foreground ui:font-normal">Add Organization</div>

            <ComingSoon />
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    </Sidebar.MenuItem>
  </Sidebar.Menu>
{/if}
