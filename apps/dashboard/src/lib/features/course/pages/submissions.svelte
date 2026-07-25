<script lang="ts">
  import { page } from '$app/state';
  import { flip } from 'svelte/animate';
  import { goto } from '$app/navigation';
  import { dndzone } from 'svelte-dnd-action';

  import { submissionApi, courseApi } from '$features/course/api';
  import { snackbar } from '$features/ui/snackbar/store';
  import type { SubmissionIdData, SubmissionItem, SubmissionSection } from '$features/course/utils/types';
  import { t } from '$lib/utils/functions/translations';

  import { UserAvatar } from '@cio/ui/custom/user-avatar';
  import MarkExerciseModal from '$features/course/components/exercise/mark-exercise-modal.svelte';
  import { STATUS } from '$features/course/components/exercise/constants';
  import { onMount } from 'svelte';
  import BookOpenIcon from '@lucide/svelte/icons/book-open';
  import InboxIcon from '@lucide/svelte/icons/inbox';

  // Per-column visual treatment, mirroring the student exercises board so both
  // Kanbans share one language. Keyed by the board statusId (1/2/3).
  const columnStyle: Record<number, { dot: string; badge: string; accent: string }> = {
    1: {
      dot: 'bg-orange-500',
      badge: 'bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300',
      accent: 'bg-orange-500'
    },
    2: {
      dot: 'bg-amber-400',
      badge: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
      accent: 'bg-amber-400'
    },
    3: {
      dot: 'bg-emerald-500',
      badge: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
      accent: 'bg-emerald-500'
    }
  };
  const styleFor = (id: number) => columnStyle[id] ?? columnStyle[1];

  interface Props {
    courseId: string;
    sections: SubmissionSection[];
    submissionIdData: { [key: string]: SubmissionIdData };
  }

  let { courseId, sections: initialSections = [], submissionIdData: initialSubmissionIdData = {} }: Props = $props();

  const flipDurationMs = 300;
  let sections = $state<SubmissionSection[]>([]);
  let submissionIdData = $state<Record<string, SubmissionIdData>>({});
  let isGradeWithAI = $state(false);
  let isSaving = $state(false);

  onMount(() => {
    sections = initialSections;
    submissionIdData = { ...initialSubmissionIdData };
  });

  const ALLOWED_BOARD_TRANSITIONS: Record<number, number[]> = {
    1: [2],
    2: [1, 3],
    3: []
  };

  const submissionId = $derived(new URLSearchParams(page.url.search).get('submissionId') ?? '');
  let openExercise = $derived.by(() => {
    return !!submissionId && !!submissionIdData[submissionId];
  });

  function canTransitionBoardStatus(previousStatusId: number, nextStatusId: number): boolean {
    if (previousStatusId === nextStatusId) return true;
    return ALLOWED_BOARD_TRANSITIONS[previousStatusId]?.includes(nextStatusId) ?? false;
  }

  function getWorkflowHintKey(item: SubmissionItem): string {
    if (item.statusId !== 2) return '';
    if (item.gradingState === 'awaiting_manual') return 'course.navItem.submissions.workflow.awaiting_manual_hint';
    if (item.gradingState === 'failed') return 'course.navItem.submissions.workflow.failed_hint';
    return '';
  }

  async function handleItemFinalize(
    columnIdx: number,
    newItems: { map: (arg0: (item: SubmissionItem) => SubmissionItem) => SubmissionItem[] }
  ) {
    let itemToWithNewStatus: SubmissionItem | undefined;

    const { id } = sections[columnIdx];

    // Set column in the UI (immutable update for reactivity)
    const mappedItems = newItems.map((item) => {
      if (item.statusId !== id) {
        if (!canTransitionBoardStatus(item.statusId, id)) {
          snackbar.error('course.navItem.submissions.workflow.invalid_transition');
          return item;
        }

        itemToWithNewStatus = item;
        return { ...item, statusId: id };
      }

      return item;
    });

    sections = sections.map((section, i) => (i === columnIdx ? { ...section, items: mappedItems } : section));

    // Update backend
    if (itemToWithNewStatus) {
      const newStatusId = id;
      submissionIdData = {
        ...submissionIdData,
        [itemToWithNewStatus.id]: {
          ...submissionIdData[itemToWithNewStatus.id],
          statusId: newStatusId
        }
      };

      await submissionApi.update(courseId, itemToWithNewStatus.id, {
        statusId: newStatusId
      });
    }
  }

  function handleDndConsiderCards(columnIdx: number) {
    return function (e) {
      sections = sections.map((section, i) => (i === columnIdx ? { ...section, items: e.detail.items } : section));
    };
  }

  function handleDndFinalizeCards(columnIdx: number) {
    return (e) => handleItemFinalize(columnIdx, e.detail.items);
  }

  function handleModalClose() {
    isGradeWithAI = false;
    goto(page.url.pathname);
  }

  async function handleDeleteSubmission(id: string, statusId: number) {
    const sectionIdx = statusId - 1;
    sections = sections.map((section, i) =>
      i === sectionIdx ? { ...section, items: section.items.filter((item) => item.id !== id) } : section
    );

    const { [id]: _, ...rest } = submissionIdData;
    submissionIdData = rest;

    await submissionApi.delete(courseId, id);

    if (submissionApi.success) {
      snackbar.success('course.navItem.submissions.grading_modal.delete_success');
    } else {
      snackbar.error('course.navItem.submissions.grading_modal.delete_error');
      return;
    }

    handleModalClose();
  }

  async function handleSave(submission: {
    id?: string;
    questionAnswerByPoint: Record<string, string | number>;
    feedback?: string;
  }) {
    isSaving = true;
    const { questionAnswerByPoint, feedback } = submission;
    const subId = submission.id ?? submissionId;

    const answers = Object.entries(questionAnswerByPoint ?? {}).map(([questionId, point]) => ({
      questionId: Number(questionId),
      points: Number(point)
    }));
    const total = answers.reduce((sum, { points }) => sum + points, 0);

    await submissionApi.updateGrades(courseId, subId, {
      answers,
      total,
      feedback: feedback || undefined,
      statusId: STATUS.GRADED
    });

    if (!submissionApi.success) {
      snackbar.error('snackbar.something');
      isSaving = false;
      return;
    }

    // Backend auto-sets status to Graded; move card to Graded column and sync submissionIdData
    const gradedStatusId = STATUS.GRADED;
    const prevSection = sections.find((s) => s.items.some((item) => item.id === subId));
    const prevStatusId = prevSection?.id ?? gradedStatusId;

    if (prevStatusId !== gradedStatusId) {
      const prevIdx = prevStatusId - 1;
      const nextIdx = gradedStatusId - 1;
      const prevItems = sections[prevIdx]?.items ?? [];
      const found = prevItems.find((item) => item.id === subId);
      const itemToWithNewStatus = found ? { ...found, statusId: gradedStatusId } : undefined;

      sections = sections.map((section, i) => {
        if (i === prevIdx) {
          return { ...section, items: prevItems.filter((item) => item.id !== subId) };
        }
        if (i === nextIdx && itemToWithNewStatus) {
          return { ...section, items: [...section.items, itemToWithNewStatus] };
        }
        return section;
      });
    }

    submissionIdData = {
      ...submissionIdData,
      [subId]: {
        ...submissionIdData[subId],
        statusId: gradedStatusId,
        questionAnswerByPoint: submission.questionAnswerByPoint ?? submissionIdData[subId]?.questionAnswerByPoint,
        feedback: feedback ?? submissionIdData[subId]?.feedback
      }
    };

    handleModalClose();

    isSaving = false;
  }
</script>

<MarkExerciseModal
  bind:open={openExercise}
  onClose={handleModalClose}
  data={submissionIdData[submissionId] || {}}
  {handleSave}
  deleteSubmission={handleDeleteSubmission}
  bind:isGradeWithAI
  {isSaving}
/>

<!-- Instructor grading board — shares the student board's visual language
     (accent bar, count badge, clean cards) while keeping drag&drop to move a
     submission between statuses and click-to-open the grading modal. -->
<div class="grid w-full grid-cols-1 gap-4 pb-4 md:grid-cols-3">
  {#each sections as { id, title, items }, idx (id)}
    {@const style = styleFor(id)}
    <div
      class="flex flex-col overflow-hidden rounded-xl border border-gray-200 bg-gray-50/60 dark:border-neutral-800 dark:bg-neutral-900/40"
      animate:flip={{ duration: flipDurationMs }}
    >
      <!-- accent bar -->
      <div class="h-1 w-full {style.accent}"></div>

      <!-- column header -->
      <div
        class="flex items-center justify-between gap-2 border-b border-gray-200 bg-white/70 px-4 py-3 dark:border-neutral-800 dark:bg-neutral-900/60"
      >
        <div class="flex items-center gap-2">
          <span class="size-2 rounded-full {style.dot}"></span>
          <p class="text-sm font-semibold text-gray-800 dark:text-neutral-100">{title}</p>
        </div>
        <span
          class="inline-flex min-w-6 items-center justify-center rounded-full px-2 py-0.5 text-xs font-semibold {style.badge}"
        >
          {items.length}
        </span>
      </div>

      <!-- column body: dnd zone; grows with content (page scrolls, not column) -->
      <div
        class="min-h-32 flex-1 space-y-2.5 px-3 py-3"
        use:dndzone={{
          items,
          flipDurationMs,
          dropTargetStyle: {
            outline: 'none',
            'background-color': 'rgba(59,91,255,0.06)',
            'border-radius': '0.75rem'
          }
        }}
        onconsider={handleDndConsiderCards(idx)}
        onfinalize={handleDndFinalizeCards(idx)}
      >
        {#if items.length === 0}
          <div class="flex min-h-32 flex-col items-center justify-center gap-2 px-4 text-center">
            <InboxIcon class="size-7 text-gray-300 dark:text-neutral-600" />
            <p class="text-xs text-gray-400 dark:text-neutral-500">
              {$t('exercises.empty_column')}
            </p>
          </div>
        {:else}
          {#each items as item (item.id)}
            <div
              class="group cursor-grab rounded-lg border bg-white p-3 transition-all hover:shadow-sm active:cursor-grabbing dark:bg-neutral-800
                {item.isEarly
                ? 'border-gray-200 hover:border-primary/40 dark:border-neutral-700 dark:hover:border-primary/50'
                : 'border-red-500/60 dark:border-red-500/50'}"
              animate:flip={{ duration: flipDurationMs }}
            >
              <!-- student -->
              <div class="mb-2 flex items-center gap-2">
                <UserAvatar src={item.student.avatarUrl} alt={item.student.username} class="h-6 w-6" />
                <p class="truncate text-xs font-medium text-gray-700 dark:text-neutral-300">
                  {item.student.username}
                </p>
              </div>

              <!-- exercise title → opens grading modal -->
              <a
                class="text-primary flex items-start gap-1 text-sm leading-snug font-medium hover:underline"
                href="{page.url.pathname}?submissionId={item.id}"
              >
                {item.exercise.title}
              </a>

              <!-- lesson meta -->
              {#if item.lesson}
                <div class="mt-2 flex items-center gap-1.5 text-xs text-gray-500 dark:text-neutral-400">
                  <BookOpenIcon class="size-3.5 shrink-0" />
                  <span class="truncate">{item.lesson.title}</span>
                </div>
              {/if}

              {#if getWorkflowHintKey(item)}
                <p class="mt-1 text-xs text-amber-600 dark:text-amber-400">
                  {$t(getWorkflowHintKey(item))}
                </p>
              {/if}

              <!-- timestamp -->
              <p class="mt-2 text-[11px] text-gray-400 dark:text-neutral-500">
                {item.submittedAt}
              </p>
            </div>
          {/each}
        {/if}
      </div>
    </div>
  {/each}
</div>
