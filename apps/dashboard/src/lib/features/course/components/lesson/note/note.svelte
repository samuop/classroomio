<script lang="ts">
  import { HTMLRender, TextEditor } from '$features/ui';
  import { SafeHtmlContent } from '@cio/ui/custom/safe-html-content';
  import { isHtmlValueEmpty } from '$lib/utils/functions/toHtml';
  import { lessonApi } from '$features/course/api';
  import { t } from '$lib/utils/functions/translations';
  import MODES from '$lib/utils/constants/mode';
  import type { Content, TiptapEditor } from '@cio/ui/custom/editor';
  import type { TLocale } from '@cio/db/types';
  import AIButton from '$features/course/components/lesson/ai-button.svelte';
  import QuoteSelection from '$features/course/components/lesson/note/quote-selection.svelte';
  import DiagramActions from '$features/course/components/lesson/note/diagram-actions.svelte';
  import { RoleBasedSecurity } from '$features/ui';
  import { page } from '$app/state';
  import type { Writable } from 'svelte/store';
  import { saveDraft } from '$features/course/utils/lesson-draft';

  interface Props {
    mode?: (typeof MODES)[keyof typeof MODES];
    lessonId?: string;
    isLoading?: Writable<boolean>;
    callAI?: (type: string) => void;
  }

  let { mode = MODES.view, lessonId = '', isLoading, callAI = () => {} }: Props = $props();

  const courseId = $derived(page.params?.id as string);

  /**
   * The redraw rewrites the SAVED lesson, so an unsaved draft would be silently
   * overwritten by the response. Block the control instead and say why.
   */
  const diagramBlockedByDraft = $derived(lessonApi.isDirty);

  async function handleRegenerateDiagram(index: number, instruction?: string) {
    if (!lessonId || !courseId) return;

    await lessonApi.regenerateDiagram({
      lessonId,
      courseId,
      locale: lessonApi.currentLocale,
      index,
      instruction
    });
  }

  let noteRoot: HTMLElement | undefined = $state();
  let editRoot: HTMLElement | undefined = $state();

  $effect(() => {
    if (mode !== MODES.edit) {
      editRoot = undefined;
    }
  });

  function bindEditorRoot(editor: TiptapEditor) {
    editRoot = editor.view.dom as HTMLElement;
  }

  let hasAtLeastOneTranslation = $derived(
    Object.values(lessonApi.translations[lessonId] || {}).some((content) => {
      return content && !!content.length;
    })
  );

  function onEditorChange(content: Content) {
    if (mode === MODES.view) return;

    if (!lessonApi.translations[lessonId]) {
      lessonApi.translations[lessonId] = {} as Record<TLocale, string>;
    }
    lessonApi.translations[lessonId][lessonApi.currentLocale] = `${content}`;

    saveDraft(lessonId, lessonApi.currentLocale, `${content}`);
    lessonApi.isDirty = true;
  }

  const content = $derived(lessonApi.translations[lessonId]?.[lessonApi.currentLocale] || '');
</script>

<!--
  Per-diagram controls, wrapped in RoleBasedSecurity so only instructors and org
  admins (roles 1 and 2) see them — the same gate the lesson page uses for its
  other authoring actions. Students get the untouched diagram.
-->
{#snippet diagramOverlay(index: number)}
  <RoleBasedSecurity allowedRoles={[1, 2]}>
    <DiagramActions
      {index}
      isBusy={lessonApi.regeneratingDiagramIndex === index}
      blockedByDraft={diagramBlockedByDraft}
      warnings={lessonApi.diagramWarnings[index] ?? []}
      onSubmit={handleRegenerateDiagram}
    />
  </RoleBasedSecurity>
{/snippet}

{#if mode === MODES.edit}
  <!-- AI Button -->
  <div class="flex justify-end gap-1">
    <AIButton {isLoading} {callAI} />
  </div>
  <!-- End AI Button -->

  <div class="mt-5 h-[60vh]">
    <TextEditor
      {content}
      onChange={(content) => onEditorChange(content)}
      onReady={bindEditorRoot}
      placeholder={$t('course.navItem.lessons.materials.tabs.note.placeholder')}
    />
  </div>
  <QuoteSelection root={editRoot} enabled />
{:else}
  <!-- View Mode -->
  {#if !isHtmlValueEmpty(content)}
    <div class="relative mx-auto w-full max-w-2xl" bind:this={noteRoot}>
      <HTMLRender>
        <SafeHtmlContent {content} svgOverlay={diagramOverlay} />
      </HTMLRender>
      <QuoteSelection root={noteRoot} enabled />
    </div>
  {:else if hasAtLeastOneTranslation}
    <p class="text-md py-2 font-normal italic dark:text-white">
      {$t('course.navItem.lessons.materials.no_translation')}
    </p>
  {/if}
{/if}
