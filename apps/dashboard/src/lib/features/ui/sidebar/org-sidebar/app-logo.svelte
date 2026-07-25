<script lang="ts">
  import * as Avatar from '@cio/ui/base/avatar';
  import * as Sidebar from '@cio/ui/base/sidebar';
  import { Skeleton } from '@cio/ui/base/skeleton';
  import { currentOrg } from '$lib/utils/store/org';
  import { shortenName } from '$lib/utils/functions/string';
  import { brandName } from '$lib/utils/branding';

  // Brand header: shows the ORG's own avatar (uploaded logo) — never a bundled
  // ClassroomIO mark. Falls back to the org initials, then to the brand name.
  const displayName = $derived($currentOrg.name || brandName);
</script>

<Sidebar.Menu>
  <Sidebar.MenuItem>
    <!-- Plain (non-clickable) brand header: no link, no button affordance. -->
    <div class="flex items-center gap-2 px-2 py-1.5 text-sm">
      {#if $currentOrg.name}
        <Avatar.Root class="ui:flex ui:size-6 ui:items-center ui:justify-center ui:rounded-md">
          <Avatar.Image src={$currentOrg.avatarUrl} alt={displayName} />
          <Avatar.Fallback class="rounded-md! text-xs">{shortenName(displayName)}</Avatar.Fallback>
        </Avatar.Root>

        <span class="truncate font-normal">{displayName}</span>
      {:else}
        <Avatar.Root class="ui:flex ui:size-6 ui:items-center ui:justify-center ui:rounded-md">
          <Avatar.Fallback class="rounded-md! text-xs">{shortenName(brandName)}</Avatar.Fallback>
        </Avatar.Root>
        <Skeleton class="h-4 w-24" />
      {/if}
    </div>
  </Sidebar.MenuItem>
</Sidebar.Menu>
