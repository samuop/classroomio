import type { Content, Editor } from '@tiptap/core';
import type { EditorState, Transaction } from '@tiptap/pm/state';

import type { EditorView } from '@tiptap/pm/view';
import type { LessonMediaKind } from '../../tools/sanitize';
import type { Snippet } from 'svelte';

/**
 * Turns a lesson-media marker into something readable in the editor. This
 * package has no access to the lesson, so the consumer supplies it; returning
 * undefined makes the card render as "not found", which is the right answer when
 * the media it points at has been deleted.
 */
export type ResolveMediaLabel = (kind: LessonMediaKind, mediaId: string) => string | undefined;

export interface EdraEditorProps {
  placeholder?: string | ((node: any) => string);
  content?: Content;
  editable?: boolean;
  editor?: Editor;
  autofocus?: boolean;
  onUpdate?: (args: { editor: Editor; transaction: Transaction }) => void;
  class?: string;
  resolveMediaLabel?: ResolveMediaLabel;
}

export interface EditorProps {
  // Content of the editor
  content?: Content;
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
  // Callback functions
  onContentChange?: (content: Content) => void;
  onEditorReady?: (editor: Editor) => void;
  onEditorDestroy?: () => void;
}

export interface EdraToolbarProps {
  editor: Editor;
  class?: string;
  excludedCommands?: string[];
  children?: Snippet<[]>;
}

export interface ShouldShowProps {
  editor: Editor;
  element: HTMLElement;
  view: EditorView;
  state: EditorState;
  oldState?: EditorState;
  from: number;
  to: number;
}
