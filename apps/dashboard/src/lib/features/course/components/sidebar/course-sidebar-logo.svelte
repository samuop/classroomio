<script lang="ts">
  import * as Avatar from '@cio/ui/base/avatar';
  import * as Sidebar from '@cio/ui/base/sidebar';
  import { Skeleton } from '@cio/ui/base/skeleton';
  import { resolve } from '$app/paths';
  import { currentOrgBrand } from '$lib/utils/store/org';
  import { shortenName } from '$lib/utils/functions/string';
  import { courseApi } from '$features/course/api';
  import { getNavItemRoute } from '$features/course/utils/functions';

  const courseTitle = $derived(courseApi.course?.title);
  const courseId = $derived(courseApi.course?.id);
</script>

<Sidebar.Menu>
  <Sidebar.MenuItem>
    <Sidebar.MenuButton
      size="sm"
      class="ui:data-[state=open]:bg-sidebar-accent ui:data-[state=open]:text-sidebar-accent-foreground"
    >
      {#snippet child({ props })}
        <a href={courseId ? resolve(getNavItemRoute(courseId), {}) : '#'} {...props}>
          {#if $currentOrgBrand.name}
            <Avatar.Root class="flex size-6! items-center justify-center rounded-md!">
              <Avatar.Image src={$currentOrgBrand.avatarUrl} alt={$currentOrgBrand.name} />
              <Avatar.Fallback class="rounded-md! text-xs">{shortenName($currentOrgBrand.name)}</Avatar.Fallback>
            </Avatar.Root>
            {#if courseTitle}
              <span class="truncate text-sm font-medium">{courseTitle}</span>
            {:else}
              <Skeleton class="h-4 w-24" />
            {/if}
          {:else}
            <Skeleton class="h-4 w-24" />
          {/if}
        </a>
      {/snippet}
    </Sidebar.MenuButton>
  </Sidebar.MenuItem>
</Sidebar.Menu>
