<script lang="ts">
  import { Editor } from '@cio/ui/custom/editor';
  import type { HTMLContent, ResolveMediaLabel, TiptapEditor } from '@cio/ui/custom/editor';
  import { brandName } from '$lib/utils/branding';

  interface Props {
    placeholder?: string | ((node: any) => string);
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
    // Let the editor grow with its content instead of scrolling in a fixed box
    autoHeight?: boolean;
    // Names a lesson-media marker for the card shown in its place while editing
    resolveMediaLabel?: ResolveMediaLabel;
    // Callback functions
    onChange?: (content: HTMLContent) => void;
    onReady?: (editor: TiptapEditor) => void;
    onEditorDestroy?: () => void;
  }

  let {
    content = '',
    showToolBar = true,
    editable = true,
    enablePersistence = false,
    contentStorageKey = 'edra-content',
    editableStorageKey = 'edra-editable',
    class: className = '',
    editorClass = '',
    autoHeight = false,
    resolveMediaLabel,
    placeholder = `Welcome to ${brandName}`,
    onChange,
    onReady,
    onEditorDestroy
  }: Props = $props();
</script>

<Editor
  {content}
  {showToolBar}
  {editable}
  {enablePersistence}
  {contentStorageKey}
  {editableStorageKey}
  class={className}
  {editorClass}
  {autoHeight}
  {resolveMediaLabel}
  {placeholder}
  onContentChange={onChange}
  onEditorReady={onReady}
  {onEditorDestroy}
/>
