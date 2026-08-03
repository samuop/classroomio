<script lang="ts">
  /**
   * Actions that operate on the canvas as a whole or on the current selection.
   *
   * The stress toggle sits here rather than in a settings panel because it is
   * something a teacher should flip while looking at the layout, several times,
   * as they move things around — it is a way of seeing, not a preference.
   */
  import { Button } from '@cio/ui/base/button';
  import UndoIcon from '@lucide/svelte/icons/undo-2';
  import RedoIcon from '@lucide/svelte/icons/redo-2';
  import CopyIcon from '@lucide/svelte/icons/copy';
  import Trash2Icon from '@lucide/svelte/icons/trash-2';
  import BringToFrontIcon from '@lucide/svelte/icons/bring-to-front';
  import SendToBackIcon from '@lucide/svelte/icons/send-to-back';
  import TypeIcon from '@lucide/svelte/icons/type';
  import SquareIcon from '@lucide/svelte/icons/square';
  import AlertTriangleIcon from '@lucide/svelte/icons/triangle-alert';
  import { t } from '$lib/utils/functions/translations';
  import { certificateEditorStore } from '../store/certificate-editor.store.svelte';
  import type { CertificateElement } from '@cio/certificates';

  interface Props {
    stressPreview: boolean;
    onToggleStress: () => void;
    overflowCount: number;
    disabled?: boolean;
  }

  let { stressPreview, onToggleStress, overflowCount, disabled = false }: Props = $props();

  const store = certificateEditorStore;
  const hasSelection = $derived(store.selectedElement !== null);

  function uniqueId(prefix: string): string {
    return `${prefix}-${Date.now().toString(36)}`;
  }

  function addText() {
    const element: CertificateElement = {
      kind: 'text',
      id: uniqueId('text'),
      x: 400,
      y: 360,
      w: 300,
      h: 60,
      content: $t('course.navItem.certificates.editor.new_text'),
      fit: 'shrink',
      style: {
        fontFamily: 'Space Grotesk',
        fontSize: 28,
        fontWeight: 400,
        lineHeight: 1.2,
        letterSpacing: 0,
        color: '#111111',
        align: 'center',
        verticalAlign: 'middle'
      }
    };

    store.addElement(element);
  }

  function addShape() {
    store.addElement({
      kind: 'shape',
      id: uniqueId('shape'),
      shape: 'rect',
      x: 430,
      y: 340,
      w: 240,
      h: 100,
      fill: store.draft.accentColor
    });
  }
</script>

<div class="ui:bg-background/90 ui:border-border flex flex-wrap items-center gap-1 rounded-md border px-2 py-1.5 shadow-sm backdrop-blur">
  <Button variant="ghost" size="sm" disabled={disabled || !store.canUndo} onclick={() => store.undo()} title="Ctrl+Z">
    <UndoIcon size={14} />
  </Button>
  <Button variant="ghost" size="sm" disabled={disabled || !store.canRedo} onclick={() => store.redo()} title="Ctrl+Shift+Z">
    <RedoIcon size={14} />
  </Button>

  <div class="ui:bg-border mx-1 h-5 w-px"></div>

  <Button variant="ghost" size="sm" {disabled} onclick={addText}>
    <TypeIcon size={14} class="mr-1" />
    {$t('course.navItem.certificates.editor.add_text')}
  </Button>
  <Button variant="ghost" size="sm" {disabled} onclick={addShape}>
    <SquareIcon size={14} class="mr-1" />
    {$t('course.navItem.certificates.editor.add_shape')}
  </Button>

  <div class="ui:bg-border mx-1 h-5 w-px"></div>

  <Button variant="ghost" size="sm" disabled={disabled || !hasSelection} onclick={() => store.reorderSelected('front')}>
    <BringToFrontIcon size={14} />
  </Button>
  <Button variant="ghost" size="sm" disabled={disabled || !hasSelection} onclick={() => store.reorderSelected('back')}>
    <SendToBackIcon size={14} />
  </Button>
  <Button variant="ghost" size="sm" disabled={disabled || !hasSelection} onclick={() => store.duplicateSelected()} title="Ctrl+D">
    <CopyIcon size={14} />
  </Button>
  <Button variant="ghost" size="sm" disabled={disabled || !hasSelection} onclick={() => store.removeSelected()}>
    <Trash2Icon size={14} />
  </Button>

  <div class="ui:bg-border mx-1 h-5 w-px"></div>

  <Button variant={stressPreview ? 'default' : 'ghost'} size="sm" onclick={onToggleStress}>
    {$t('course.navItem.certificates.editor.stress_preview')}
  </Button>

  {#if overflowCount > 0}
    <!-- Counted from the renderer that produces the PDF, so this is not a guess
         about what might overflow — it is what will. -->
    <span class="ml-1 flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
      <AlertTriangleIcon size={13} />
      {$t('course.navItem.certificates.editor.overflow_warning', { count: overflowCount })}
    </span>
  {/if}
</div>
