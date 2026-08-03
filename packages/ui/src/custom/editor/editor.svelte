<script lang="ts">
  import type { HTMLContent, Content, Editor } from '@tiptap/core';
  import type { Transaction } from '@tiptap/pm/state';
  import type { ResolveMediaLabel } from './types';
  import { EdraEditor, EdraToolBar, EdraBubbleMenu, EdraDragHandleExtended } from './ui';
  import { slide } from 'svelte/transition';
  import { cn } from '$src/tools';

  interface Props {
    // Content of the editor
    content?: HTMLContent;
    // Whether the toolbar should be visible
    showToolBar?: boolean;
    // Whether the editor is editable
    editable?: boolean;
    // Whether to enable localStorage persistence
    enablePersistence?: boolean;
    // localStorage key for content persistence
    contentStorageKey?: string;
    // localStorage key for editable state persistence
    editableStorageKey?: string;
    // CSS class for the editor wrapper
    class?: string;
    // CSS class for the editor itself
    editorClass?: string;
    /**
     * Let the editor grow with its content instead of scrolling inside a fixed
     * box. Needed as a prop rather than an `editorClass` override because the
     * default height is prefixed (`ui:h-128`) and consumers outside this package
     * compile unprefixed utilities: `cn()` sees two different modifier sets so it
     * keeps both, and `output.css` is imported last so the prefixed one wins.
     */
    autoHeight?: boolean;
    // Names a lesson-media marker for the in-editor card; see ResolveMediaLabel
    resolveMediaLabel?: ResolveMediaLabel;
    // Placeholder text for the editor
    placeholder?: string | ((node: any) => string);
    // Callback functions
    onContentChange?: (content: HTMLContent) => void;
    onEditorReady?: (editor: Editor) => void;
    onEditorDestroy?: () => void;
  }

  let {
    content = $bindable(''),
    showToolBar = true,
    editable = true,
    enablePersistence = false,
    contentStorageKey = 'edra-content',
    editableStorageKey = 'edra-editable',
    class: className = '',
    editorClass = '',
    autoHeight = false,
    resolveMediaLabel,
    placeholder,
    onContentChange,
    onEditorReady
  }: Props = $props();

  let editor = $state<Editor>();

  // Browser detection
  const browser = typeof window !== 'undefined';

  function normalizeEditorContent(value: HTMLContent | undefined): string {
    const html = String(value ?? '').trim();

    if (html === '' || html === '<p></p>' || html === '<p><br></p>') return '';

    return html;
  }

  // Handle content persistence
  $effect(() => {
    if (enablePersistence && browser && content) {
      localStorage.setItem(contentStorageKey, JSON.stringify(content));
    }
  });

  // Handle editable state persistence
  $effect(() => {
    if (enablePersistence && browser) {
      localStorage.setItem(editableStorageKey, editable.toString());
    }
  });

  // Load persisted content and editable state on mount
  $effect(() => {
    if (enablePersistence && browser) {
      try {
        // Load content
        const rawContentString = localStorage.getItem(contentStorageKey);
        if (rawContentString !== null) {
          console.log('persistedContent', rawContentString);
          content = rawContentString;
        }

        // Load editable state
        const rawEditableString = localStorage.getItem(editableStorageKey);
        if (rawEditableString !== null) {
          editable = rawEditableString === 'true';
        }
      } catch (error) {
        console.warn('Failed to load persisted state:', error);
      }
    }
  });

  let isEditorReady = $state(false);
  // Handle editor ready
  $effect(() => {
    if (editor && !isEditorReady) {
      isEditorReady = true;
      onEditorReady?.(editor);
    }
  });

  $effect(() => {
    if (!editor || editor.isDestroyed) return;

    const nextContent = normalizeEditorContent(content);
    const currentContent = normalizeEditorContent(editor.getHTML());

    if (currentContent === nextContent) return;

    editor.commands.setContent(nextContent, false);
  });

  function onUpdate(props: { editor: Editor; transaction: Transaction }) {
    if (props?.editor && !props.editor.isDestroyed) {
      const newContent = props.editor.getHTML();
      content = newContent;
      onContentChange?.(newContent);
    }
  }
</script>

{#if browser}
  <div
    class={cn(
      'ui:relative ui:bg-background ui:z-50 ui:flex ui:size-full ui:w-full ui:flex-col ui:rounded-md ui:border ui:border-dashed',
      className
    )}
  >
    {#if editor && !editor.isDestroyed}
      {#if showToolBar}
        <div transition:slide>
          <!--
            The toolbar wraps rather than scrolling sideways: a clipped row hides
            controls behind a scrollbar nobody looks for.
          -->
          <EdraToolBar
            class="ui:bg-secondary/50 ui:flex ui:w-full ui:flex-wrap ui:items-center ui:border-b ui:border-dashed ui:p-0.5"
            {editor}
          />
        </div>
      {/if}
      <EdraBubbleMenu {editor} />

      {#if editable}
        <EdraDragHandleExtended {editor} />
      {/if}
    {/if}
    <EdraEditor
      class={cn(
        'ui:relative ui:p-4',
        !autoHeight && 'ui:h-128 ui:overflow-auto',
        autoHeight && 'ui:h-auto',
        editorClass
      )}
      bind:editor
      {editable}
      {content}
      {onUpdate}
      {placeholder}
      {resolveMediaLabel}
    />
  </div>
{/if}
