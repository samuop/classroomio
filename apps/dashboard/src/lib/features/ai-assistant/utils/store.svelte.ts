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
 *
 * `rehacerPlan`: el texto le pide al asistente otro plan (lo escribe la pantalla
 * de Fuentes cuando se agrega una fuente con un plan ya armado). Si la docente
 * lo manda, viaja como pedido de cambios al plan, que es lo que obliga al
 * servidor a devolver un plan nuevo en vez de una respuesta en prosa.
 */
export type ChatDraft = { text: string; mode: 'append' | 'new'; rehacerPlan?: boolean };

export const chatDraft = writable<ChatDraft | null>(null);

export function clearChatDraft() {
  chatDraft.set(null);
}

export function setChatDraft(draft: ChatDraft) {
  chatDraft.set(draft);
}

/**
 * Si el chat tiene un turno que falló y se puede volver a pedir.
 *
 * Lo escribe el chat; lo lee el botón «Regenerar» de la vista del curso vacío
 * (`lessons.svelte`), que vive fuera del panel. Antes ese botón miraba «el
 * último texto escrito», que sólo se actualizaba al escribir: después de
 * aprobar un plan, regenerar mandaba como mensaje nuevo la descripción original
 * del curso. Lo que se reintenta ahora es el turno que falló, y eso sólo existe
 * en la memoria del chat abierto — por eso el chat lo apaga al cerrarse.
 */
let reintentoDisponibleState = $state(false);

export function hayReintentoDisponible(): boolean {
  return reintentoDisponibleState;
}

export function setReintentoDisponible(disponible: boolean) {
  reintentoDisponibleState = disponible;
}

/**
 * Pending retry signal. Any component that can issue a retry (e.g. the chat
 * input's "Reintentar" button, or the empty-course "Regenerate" button) sets
 * this to `true`. The chat component subscribes and, when it sees the flag
 * flip, retries the turn that failed and clears the flag.
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
