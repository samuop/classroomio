import { writable } from 'svelte/store';
import type { CourseTemplateId } from '@cio/ai-assistant';
import { sidePanel } from '$features/side-panel';

/**
 * AI assistant is one of several side-panel apps. These helpers proxy to the
 * generic side-panel store so existing call sites keep working.
 */
export const AI_ASSISTANT_PANEL_ID = 'ai-assistant';

export function openAiAssistant() {
  sidePanel.open(AI_ASSISTANT_PANEL_ID);
}

export function closeAiAssistant() {
  sidePanel.close();
}

export function toggleAiAssistant() {
  sidePanel.toggle(AI_ASSISTANT_PANEL_ID);
}

export const initialChatTemplateId = writable<CourseTemplateId | null>(null);

export function setInitialChatTemplateId(id: CourseTemplateId) {
  initialChatTemplateId.set(id);
}

export function clearInitialChatTemplateId() {
  initialChatTemplateId.set(null);
}

/** Carries a prompt from the home page course creator into the AI chat on first open. */
export const initialChatPrompt = writable<string | null>(null);

export function setInitialChatPrompt(prompt: string) {
  initialChatPrompt.set(prompt);
}

export function clearInitialChatPrompt() {
  initialChatPrompt.set(null);
}

/** Draft document IDs uploaded in the course-creation wizard, attached to the first chat message. */
export const initialChatDocumentIds = writable<string[]>([]);

export function setInitialChatDocumentIds(ids: string[]) {
  initialChatDocumentIds.set(ids);
}

export function clearInitialChatDocumentIds() {
  initialChatDocumentIds.set([]);
}

/**
 * Template answers collected by the wizard. When set, the first chat message
 * carries them as `submit_template_answers` so the agent skips its own form.
 */
export const initialChatTemplateAnswers = writable<Record<string, string> | null>(null);

export function setInitialChatTemplateAnswers(answers: Record<string, string>) {
  initialChatTemplateAnswers.set(answers);
}

export function clearInitialChatTemplateAnswers() {
  initialChatTemplateAnswers.set(null);
}

/**
 * Pending composer action picked up by the chat component:
 * - `append` adds the text to whatever is already in the input (panel was open).
 * - `new` starts a fresh conversation and replaces the input (panel was closed).
 */
export type ChatDraft = { text: string; mode: 'append' | 'new' };

export const chatDraft = writable<ChatDraft | null>(null);

export function clearChatDraft() {
  chatDraft.set(null);
}

export function setChatDraft(draft: ChatDraft) {
  chatDraft.set(draft);
}

/**
 * The last user-typed text the agent actually tried to send. Module-level
 * (not tied to the chat component) so the empty-course view in
 * `lessons.svelte` can read it and offer a "Regenerate" button without
 * having to mount the chat panel first.
 */
let lastSentTextState: string | null = $state(null);

export function getLastSentText(): string | null {
  return lastSentTextState;
}

export function setLastSentText(text: string | null) {
  lastSentTextState = text;
}

/**
 * Pending retry signal. Any component that can issue a retry (e.g. the chat
 * input's "Reintentar" button, or the empty-course "Regenerate" button) sets
 * this to `true`. The chat component subscribes and, when it sees the flag
 * flip, re-sends the saved `lastSentText` and clears the flag. The flag is
 * idempotent: if the chat isn't mounted when the retry is requested, it is
 * processed the next time the chat mounts.
 */
let pendingRetryState = $state(false);

export function isRetryPending(): boolean {
  return pendingRetryState;
}

export function requestRetry() {
  pendingRetryState = true;
}

export function consumeRetry(): boolean {
  if (pendingRetryState) {
    pendingRetryState = false;
    return true;
  }
  return false;
}

function mdQuote(body: string) {
  return body
    .trim()
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
}

/**
 * Quote `text` into the assistant. If the panel is already open the quote is
 * appended to the current draft; otherwise a new conversation is opened.
 */
export function quoteInChat(text: string) {
  const quoted = mdQuote(text);

  if (!quoted.trim()) {
    return;
  }

  const isOpen = sidePanel.activePanelId === AI_ASSISTANT_PANEL_ID;

  chatDraft.set({ text: quoted, mode: isOpen ? 'append' : 'new' });

  if (!isOpen) {
    openAiAssistant();
  }
}
