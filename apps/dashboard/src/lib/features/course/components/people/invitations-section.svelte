<script lang="ts">
  import * as Table from '@cio/ui/base/table';
  import * as DropdownMenu from '@cio/ui/base/dropdown-menu';
  import { Badge, type BadgeVariant } from '@cio/ui/base/badge';
  import { Button } from '@cio/ui/base/button';
  import { Spinner } from '@cio/ui/base/spinner';
  import EllipsisVerticalIcon from '@lucide/svelte/icons/ellipsis-vertical';
  import MailWarningIcon from '@lucide/svelte/icons/mail-warning';
  import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
  import { calDateDiff } from '$lib/utils/functions/date';
  import { t } from '$lib/utils/functions/translations';
  import { peopleApi } from '$features/course/api';
  import { orgApi } from '$features/org/api/org.svelte';
  import type { CourseInvitationItem } from '$features/course/utils/types';

  /**
   * The invited-but-not-yet-joined half of a course's roster.
   *
   * The People table above lists group members, which a brand-new invitee only
   * becomes once they accept — so until then they appeared nowhere at all and
   * the teacher had no way to tell "the mail is on its way" from "nothing
   * happened". Everyone here is someone an invite was addressed to.
   */
  const INVITATIONS = 'course.navItem.people.invitations';

  interface Props {
    courseId: string;
  }

  let { courseId }: Props = $props();

  /** Email of the row whose resend/revoke is in flight, so only it locks up. */
  let busyEmail = $state<string | null>(null);

  const invitations = $derived(peopleApi.invitations);
  const summary = $derived(peopleApi.invitationSummary);

  /**
   * Enrollment wins over the invite's own status: someone can be given access
   * directly while an old invite of theirs is still pending, and what the
   * teacher needs to know is whether the person is in.
   */
  function statusOf(invitation: CourseInvitationItem): 'joined' | 'accepted_no_access' | 'pending' | 'expired' | 'revoked' {
    if (invitation.enrolled) return 'joined';
    if (invitation.status === 'accepted') return 'accepted_no_access';
    return invitation.status;
  }

  function badgeVariant(status: ReturnType<typeof statusOf>): BadgeVariant {
    if (status === 'joined') return 'success';
    if (status === 'pending') return 'warning';
    if (status === 'accepted_no_access') return 'destructive';
    return 'outline';
  }

  function canResend(invitation: CourseInvitationItem): boolean {
    return !invitation.enrolled && invitation.status !== 'accepted';
  }

  function canRevoke(invitation: CourseInvitationItem): boolean {
    return !invitation.enrolled && invitation.status === 'pending';
  }

  async function refresh() {
    await peopleApi.loadInvitations(courseId);
  }

  /**
   * Loading lives here rather than in the page because this component only
   * mounts for admins and tutors — the endpoint answers 403 to anyone else, and
   * a student who typed the URL would have collected an error snackbar for a
   * section they cannot see.
   */
  $effect(() => {
    if (!courseId) return;

    void peopleApi.loadInvitations(courseId);
  });

  async function resend(email: string) {
    busyEmail = email;
    try {
      await orgApi.resendAudienceInvite({ email });
      await refresh();
    } finally {
      busyEmail = null;
    }
  }

  async function revoke(email: string) {
    busyEmail = email;
    try {
      await orgApi.revokeAudienceInvite({ email });
      await refresh();
    } finally {
      busyEmail = null;
    }
  }
</script>

{#if invitations.length > 0 || peopleApi.isLoadingInvitations}
  <section class="space-y-2">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div>
        <h2 class="text-base font-semibold">{$t(`${INVITATIONS}.title`)}</h2>
        {#if summary}
          <p class="ui:text-muted-foreground text-sm">
            {$t(`${INVITATIONS}.summary`, {
              joined: summary.joined,
              pending: summary.pending,
              total: summary.total
            })}
          </p>
        {/if}
      </div>

      <Button variant="outline" size="sm" onclick={refresh} disabled={peopleApi.isLoadingInvitations}>
        {#if peopleApi.isLoadingInvitations}
          <Spinner class="mr-1 h-3 w-3" />
        {:else}
          <RefreshCwIcon size={14} class="mr-1" />
        {/if}
        {$t('common.refresh')}
      </Button>
    </div>

    <div class="rounded-md border">
      <Table.Root>
        <Table.Header>
          <Table.Row>
            <Table.Head>{$t(`${INVITATIONS}.person`)}</Table.Head>
            <Table.Head>{$t(`${INVITATIONS}.status`)}</Table.Head>
            <Table.Head>{$t(`${INVITATIONS}.invited_at`)}</Table.Head>
            <Table.Head class="text-right">{$t('course.navItem.people.action')}</Table.Head>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {#each invitations as invitation (invitation.id)}
            {@const status = statusOf(invitation)}
            <Table.Row>
              <Table.Cell>
                <div class="flex flex-col">
                  {#if invitation.name}
                    <span class="font-medium">{invitation.name}</span>
                  {/if}
                  <span class="ui:text-muted-foreground text-sm">{invitation.email}</span>
                </div>
              </Table.Cell>

              <Table.Cell>
                <div class="flex flex-wrap items-center gap-1.5">
                  <Badge variant={badgeVariant(status)}>{$t(`${INVITATIONS}.status_${status}`)}</Badge>

                  <!-- The invite email is queued, not sent inline, so a failure
                       here is the difference between "waiting" and "never told". -->
                  {#if !invitation.enrolled && !invitation.emailSentAt}
                    <span
                      class="ui:text-muted-foreground flex items-center gap-1 text-xs"
                      title={$t(`${INVITATIONS}.email_not_sent_hint`)}
                    >
                      <MailWarningIcon size={12} />
                      {$t(`${INVITATIONS}.email_not_sent`)}
                    </span>
                  {/if}
                </div>
              </Table.Cell>

              <Table.Cell class="ui:text-muted-foreground text-sm">
                {calDateDiff(invitation.invitedAt)}
              </Table.Cell>

              <Table.Cell class="text-right">
                {#if canResend(invitation) || canRevoke(invitation)}
                  <DropdownMenu.Root>
                    <DropdownMenu.Trigger
                      class="hover:ui:bg-muted inline-flex items-center justify-center rounded-md p-1.5"
                      aria-label={$t('audience.invite.row_actions_aria')}
                      disabled={busyEmail === invitation.email}
                    >
                      <EllipsisVerticalIcon class="ui:size-4 ui:text-muted-foreground" />
                    </DropdownMenu.Trigger>
                    <DropdownMenu.Content align="end">
                      {#if canResend(invitation)}
                        <DropdownMenu.Item
                          disabled={busyEmail === invitation.email}
                          onclick={() => resend(invitation.email)}
                        >
                          {$t('audience.invite.resend')}
                        </DropdownMenu.Item>
                      {/if}
                      {#if canRevoke(invitation)}
                        <DropdownMenu.Item
                          class="ui:text-destructive focus:ui:text-destructive"
                          disabled={busyEmail === invitation.email}
                          onclick={() => revoke(invitation.email)}
                        >
                          {$t('audience.invite.revoke')}
                        </DropdownMenu.Item>
                      {/if}
                    </DropdownMenu.Content>
                  </DropdownMenu.Root>
                {/if}
              </Table.Cell>
            </Table.Row>
          {/each}
        </Table.Body>
      </Table.Root>
    </div>
  </section>
{/if}
