<script lang="ts">
  import * as Avatar from '@cio/ui/base/avatar';
  import * as Sidebar from '@cio/ui/base/sidebar';
</script>

<Sidebar.Menu>
  <Sidebar.MenuItem>
    <!-- Plain (non-clickable) brand header: no link, no button affordance. -->
    <div class="flex items-center gap-2 px-2 py-1.5 text-sm">
      <Avatar.Root class="ui:flex ui:size-6 ui:items-center ui:justify-center">
        <Avatar.Image src="/logo-192.png" alt="ClassroomIO logo" />
      </Avatar.Root>

      <span class="truncate font-normal">ClassroomIO</span>
    </div>
  </Sidebar.MenuItem>
</Sidebar.Menu>
