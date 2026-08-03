<script lang="ts">
  import {
    CANVAS_EDITOR_ENABLED,
    CERTIFICATE_TEMPLATES,
    type BindingValues,
    type CertificateRenderData,
    type CertificateTemplateId
  } from '@cio/certificates';
  import { Button } from '@cio/ui/base/button';
  import PenToolIcon from '@lucide/svelte/icons/pen-tool';
  import RotateCcwIcon from '@lucide/svelte/icons/rotate-ccw';
  import { t } from '$lib/utils/functions/translations';
  import { cn } from '@cio/ui/tools';
  import TemplateThumb from './template-thumb.svelte';
  import { certificateEditorStore } from '../store/certificate-editor.store.svelte';

  interface Props {
    value: CertificateTemplateId;
    onSelect: (id: CertificateTemplateId) => void;
    /** What the canvas is seeded from: the template is measured against this data. */
    seed: { data: CertificateRenderData; values: BindingValues };
    disabled?: boolean;
  }

  let { value, onSelect, seed, disabled = false }: Props = $props();

  const store = certificateEditorStore;

  // Measuring renders the template offscreen and waits for its fonts, so it is
  // fast but not instant. Without this the button looks dead for a moment on
  // the one click that matters most.
  let isSeeding = $state(false);

  async function toCanvas() {
    isSeeding = true;
    try {
      await store.switchToCanvas(seed.data, seed.values);
    } finally {
      isSeeding = false;
    }
  }

  function revert() {
    // Dropping the canvas throws away real design work, so it is the one action
    // here that asks first.
    if (confirm($t('course.navItem.certificates.editor.revert_to_template_confirm'))) {
      store.revertToTemplate();
    }
  }
</script>

<div class="grid grid-cols-2 gap-3">
  {#each CERTIFICATE_TEMPLATES as template (template.id)}
    {@const isActive = template.id === value}
    <button
      type="button"
      class={cn(
        'group ui:border-border relative aspect-[1.4/1] overflow-hidden rounded-md border bg-white text-left transition-transform',
        'hover:-translate-y-0.5 hover:shadow-md',
        isActive && 'ui:border-primary ui:ring-primary -translate-y-0.5 shadow-md ring-2',
        disabled && 'cursor-not-allowed opacity-60 hover:translate-y-0 hover:shadow-none'
      )}
      {disabled}
      aria-pressed={isActive}
      onclick={() => onSelect(template.id)}
    >
      <TemplateThumb id={template.id} />
      <span
        class={cn(
          'absolute right-0 bottom-0 left-0 px-2 py-1 text-center text-[9px] font-medium tracking-[0.18em] uppercase',
          isActive ? 'ui:bg-primary ui:text-primary-foreground' : 'ui:bg-foreground ui:text-background'
        )}
      >
        {template.label}
      </span>
    </button>
  {/each}
</div>

<!--
  The way onto the free canvas, parked with the canvas itself. See
  CANVAS_EDITOR_ENABLED in @cio/certificates for why, and for what to flip to
  bring it back — the store and the renderer read the same constant.
-->
{#if CANVAS_EDITOR_ENABLED}
  <div class="mt-4 rounded-md border p-3">
    {#if store.isCanvas}
      <p class="text-xs font-medium">{$t('course.navItem.certificates.editor.canvas_active')}</p>
      <Button variant="ghost" size="sm" class="mt-2 w-full" {disabled} onclick={revert}>
        <RotateCcwIcon size={14} class="mr-1.5" />
        {$t('course.navItem.certificates.editor.revert_to_template')}
      </Button>
    {:else}
      <Button variant="secondary" size="sm" class="w-full" disabled={disabled || isSeeding} onclick={toCanvas}>
        <PenToolIcon size={14} class="mr-1.5" />
        {$t('course.navItem.certificates.editor.switch_to_canvas')}
      </Button>
      <p class="ui:text-muted-foreground mt-2 text-xs">
        {$t('course.navItem.certificates.editor.switch_to_canvas_hint')}
      </p>
    {/if}
  </div>
{/if}

<p class="ui:text-muted-foreground mt-4 text-xs">
  {$t('course.navItem.certificates.editor.templates_hint')}
</p>
