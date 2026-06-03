<script lang="ts">
  import { resolve } from '$app/paths';
  import { goto } from '$app/navigation';
  import { basePath } from '$lib/utils/store/app';
  import * as DropdownMenu from '@cio/ui/base/dropdown-menu';
  import InfoIcon from '@lucide/svelte/icons/info';
  import LogOutIcon from '@lucide/svelte/icons/log-out';
  import * as Sidebar from '@cio/ui/base/sidebar';
  import { UserAvatar } from '@cio/ui/custom/user-avatar';
  import { useSidebar } from '@cio/ui/base/sidebar';
  import ChevronsUpDownIcon from '@lucide/svelte/icons/chevrons-up-down';
  import ThemeToggle from './theme-toggle.svelte';

  import { t } from '$lib/utils/functions/translations';
  import { profile } from '$lib/utils/store/user';
  import { currentOrg } from '$lib/utils/store/org';
  import { ROLE } from '@cio/utils/constants';

  const sidebar = useSidebar();

  function getRoleLabel(roleId: number): string {
    if (roleId === ROLE.ADMIN) return $t('course.navItem.people.roles.admin');
    if (roleId === ROLE.TUTOR) return $t('course.navItem.people.roles.tutor');
    if (roleId === ROLE.STUDENT) return $t('course.navItem.people.roles.student');
    return '';
  }
</script>

<!--

  SNIPPETS

-->
{#snippet avatarblock()}
  <UserAvatar src={$profile.avatarUrl} alt={$profile.fullname} />
  <div class="grid flex-1 text-left text-sm leading-tight font-normal">
    <span class="truncate">{$profile.fullname}</span>
    <span class="truncate text-xs">{$profile.email}</span>
  </div>
{/snippet}

{#snippet triggeravatar()}
  <UserAvatar src={$profile.avatarUrl} alt={$profile.fullname} />
  <div class="grid flex-1 text-left text-sm leading-tight font-normal">
    <span class="truncate">{$profile.fullname}</span>
    <span class="truncate text-xs">{getRoleLabel($currentOrg.roleId)}</span>
  </div>
{/snippet}

{#snippet usertrigger()}
  <DropdownMenu.Label class="p-0">
    <a href={resolve(`${$basePath}/settings`, {})} class="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
      <UserAvatar src={$profile.avatarUrl} alt={$profile.fullname} />
      <div class="grid flex-1 text-left text-sm leading-tight font-normal">
        <span class="truncate">{$profile.fullname}</span>
        <span class="truncate text-xs">{$profile.email}</span>
      </div>
    </a>
  </DropdownMenu.Label>
{/snippet}

{#snippet themetoggle()}
  <DropdownMenu.Label class="p-0 font-normal">
    <ThemeToggle />
  </DropdownMenu.Label>
{/snippet}

<!--

  COMPONENT

-->
<Sidebar.Menu>
  <Sidebar.MenuItem>
    <DropdownMenu.Root>
      <!-- DROPDOWN TRIGGER -->
      <DropdownMenu.Trigger>
        {#snippet child({ props })}
          <Sidebar.MenuButton
            size="lg"
            class="ui:data-[state=open]:bg-sidebar-accent ui:data-[state=open]:text-sidebar-accent-foreground"
            {...props}
          >
            {@render triggeravatar()}
            <ChevronsUpDownIcon class="ml-auto size-4" />
          </Sidebar.MenuButton>
        {/snippet}
      </DropdownMenu.Trigger>

      <!-- DROPDOWN CONTENT -->
      <DropdownMenu.Content
        class="ui:w-(--bits-dropdown-menu-anchor-width) ui:min-w-56 ui:rounded-lg"
        side={sidebar.isMobile ? 'bottom' : 'right'}
        align="end"
        sideOffset={4}
      >
        {@render usertrigger()}

        <DropdownMenu.Separator />
        {@render themetoggle()}

        <DropdownMenu.Separator />

        <DropdownMenu.Group>
          <div class="cursor-pointer space-y-2">
            <!-- Licence/attribution must always be reachable (AGPL fork requirement). -->
            <div class="space-y-4">
              <DropdownMenu.Item class="m-0">
                <a href={resolve('/legal', {})} class="flex h-full w-full items-center justify-start space-x-2 text-start">
                  <InfoIcon size={20} />
                  <p class="text-sm dark:text-white">{$t('legal.menu_link')}</p>
                </a>
              </DropdownMenu.Item>
            </div>

            <DropdownMenu.Separator />

            <DropdownMenu.Item onclick={() => goto(resolve(`/logout`, {}))}>
              <span class="flex items-center gap-2">
                <LogOutIcon />
                <p class="text-sm">{$t('settings.profile.logout')}</p>
              </span>
            </DropdownMenu.Item>
          </div>
        </DropdownMenu.Group>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  </Sidebar.MenuItem>
</Sidebar.Menu>
