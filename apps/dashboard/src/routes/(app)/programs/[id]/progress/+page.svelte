<script lang="ts">
  import * as Avatar from '@cio/ui/base/avatar';
  import * as Page from '@cio/ui/base/page';
  import * as Table from '@cio/ui/base/table';
  import { Badge } from '@cio/ui/base/badge';
  import { Button } from '@cio/ui/base/button';
  import { Empty } from '@cio/ui/custom/empty';
  import BookOpenIcon from '@lucide/svelte/icons/book-open';
  import CircleCheckIcon from '@lucide/svelte/icons/circle-check';
  import LayersIcon from '@lucide/svelte/icons/layers';
  import UsersIcon from '@lucide/svelte/icons/users';
  import DownloadIcon from '@lucide/svelte/icons/download';

  import { t } from '$lib/utils/functions/translations';
  import { ActivityCard } from '$features/ui';
  import { programApi } from '$features/program/api';
  import { downloadCSV } from '$lib/utils/functions/download-csv';
  import { shortenName } from '$lib/utils/functions/string';

  let { data } = $props();

  $effect(() => {
    if (data.programId) programApi.getProgress(data.programId);
  });

  const progress = $derived(programApi.progress);

  const summaryCards = $derived([
    {
      title: $t('program_progress.card_avg_progress'),
      description: $t('program_progress.card_avg_progress_description'),
      icon: LayersIcon,
      percentage: progress?.summary.averageProgress ?? 0,
      isCount: false
    },
    {
      title: $t('program_progress.card_members'),
      description: $t('program_progress.card_members_description'),
      icon: UsersIcon,
      percentage: progress?.summary.totalMembers ?? 0,
      isCount: true
    },
    {
      title: $t('program_progress.card_courses'),
      description: $t('program_progress.card_courses_description'),
      icon: BookOpenIcon,
      percentage: progress?.summary.totalCourses ?? 0,
      isCount: true
    },
    {
      title: $t('program_progress.card_completed'),
      description: $t('program_progress.card_completed_description'),
      icon: CircleCheckIcon,
      percentage: progress?.summary.completedCount ?? 0,
      isCount: true
    }
  ]);

  function exportCSV() {
    if (!progress) return;

    const rows = progress.members.map((member) => {
      const row: Record<string, string | number> = {
        [$t('program_progress.member')]: member.fullname,
        [$t('program_progress.email')]: member.email
      };
      for (const course of progress.courses) {
        row[course.title] = `${member.perCourse[course.courseId] ?? 0}%`;
      }
      row[$t('program_progress.overall')] = `${member.overallProgress}%`;
      return row;
    });

    downloadCSV(rows, 'program-progress');
  }
</script>

<Page.Root class="mx-auto w-full max-w-5xl px-4">
  <Page.Header>
    <Page.HeaderContent>
      <Page.Title>{$t('program_progress.tab_title')}</Page.Title>
    </Page.HeaderContent>
    <Page.Action>
      <Button variant="outline" size="sm" onclick={exportCSV} disabled={!progress || progress.members.length === 0}>
        <DownloadIcon size={16} class="mr-1" />
        {$t('program_progress.export_csv')}
      </Button>
    </Page.Action>
  </Page.Header>

  <Page.Body>
    {#snippet child()}
      {#if progress}
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {#each summaryCards as card (card.title)}
            <ActivityCard
              activity={{
                title: card.title,
                description: card.description,
                icon: card.icon,
                percentage: card.percentage,
                hidePercentage: card.isCount
              }}
            />
          {/each}
        </div>

        {#if progress.members.length === 0}
          <Empty
            title={$t('program_progress.empty_title')}
            description={$t('program_progress.empty')}
            icon={UsersIcon}
            variant="page"
          />
        {:else}
          <div class="mt-6 overflow-x-auto rounded-md border">
            <Table.Root>
              <Table.Header>
                <Table.Row>
                  <Table.Head class="sticky left-0 min-w-[200px]">{$t('program_progress.member')}</Table.Head>
                  {#each progress.courses as course (course.courseId)}
                    <Table.Head class="min-w-[120px] text-center">{course.title}</Table.Head>
                  {/each}
                  <Table.Head class="min-w-[100px] text-center font-semibold">
                    {$t('program_progress.overall')}
                  </Table.Head>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {#each progress.members as member (member.profileId)}
                  <Table.Row>
                    <Table.Cell class="sticky left-0">
                      <div class="flex items-center gap-2">
                        <Avatar.Root class="size-7">
                          {#if member.avatarUrl}
                            <Avatar.Image src={member.avatarUrl} alt={member.fullname || 'User'} />
                          {/if}
                          <Avatar.Fallback>{shortenName(member.fullname || member.email)}</Avatar.Fallback>
                        </Avatar.Root>
                        <div class="min-w-0">
                          <p class="truncate text-sm font-medium">{member.fullname}</p>
                          <p class="ui:text-muted-foreground truncate text-xs">{member.email}</p>
                        </div>
                      </div>
                    </Table.Cell>
                    {#each progress.courses as course (course.courseId)}
                      <Table.Cell class="text-center">{member.perCourse[course.courseId] ?? 0}%</Table.Cell>
                    {/each}
                    <Table.Cell class="text-center">
                      {#if member.overallProgress >= 100}
                        <Badge class="bg-green-200 text-green-700">{member.overallProgress}%</Badge>
                      {:else}
                        <Badge type="outline">{member.overallProgress}%</Badge>
                      {/if}
                    </Table.Cell>
                  </Table.Row>
                {/each}
              </Table.Body>
            </Table.Root>
          </div>
        {/if}
      {/if}
    {/snippet}
  </Page.Body>
</Page.Root>
