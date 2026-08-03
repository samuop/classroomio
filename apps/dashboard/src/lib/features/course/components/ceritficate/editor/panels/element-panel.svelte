<script lang="ts">
  /**
   * Properties of the selected element.
   *
   * Every control checkpoints before it writes, so each adjustment is one press
   * of undo. That is coarser than the canvas gestures (which checkpoint once per
   * drag) and it is the right granularity here: a click on "bold" is a discrete
   * decision, not a motion.
   */
  import * as Field from '@cio/ui/base/field';
  import { InputField } from '@cio/ui/custom/input-field';
  import { Button } from '@cio/ui/base/button';
  import { BINDING_KEYS, type BindingKey } from '@cio/certificates';
  import { t } from '$lib/utils/functions/translations';
  import { certificateEditorStore } from '../store/certificate-editor.store.svelte';

  interface Props {
    disabled?: boolean;
  }

  let { disabled = false }: Props = $props();

  const store = certificateEditorStore;
  const element = $derived(store.selectedElement);

  /**
   * The families already loaded by the renderer's Google Fonts link. Offering
   * anything else would render fine in the editor — the browser has system
   * fonts — and fall back to something else entirely in the exported PDF, which
   * fetches only this list.
   */
  const FONT_FAMILIES = [
    'Cormorant Garamond',
    'Bodoni Moda',
    'Playfair Display',
    'Cinzel',
    'Archivo Black',
    'Space Grotesk',
    'DM Mono',
    'JetBrains Mono'
  ];

  const WEIGHTS = [300, 400, 500, 600, 700, 900];

  function patchStyle(patch: Record<string, unknown>) {
    if (!element || element.kind !== 'text') return;

    store.checkpoint();
    store.updateElement(element.id, { style: { ...element.style, ...patch } } as never);
  }

  function patch(values: Record<string, unknown>) {
    if (!element) return;

    store.checkpoint();
    store.updateElement(element.id, values as never);
  }

  function insertBinding(key: BindingKey) {
    if (!element || element.kind !== 'text') return;

    store.checkpoint();
    store.updateElement(element.id, { content: `${element.content}{{${key}}}` } as never);
  }
</script>

{#if !element}
  <p class="ui:text-muted-foreground text-xs">
    {$t('course.navItem.certificates.editor.no_selection')}
  </p>
{:else}
  <Field.Group>
    <Field.Set>
      <Field.Legend>{$t('course.navItem.certificates.editor.position')}</Field.Legend>
      <div class="grid grid-cols-4 gap-2">
        <InputField label="X" type="number" value={Math.round(element.x)} isDisabled={disabled}
          onInputChange={(event) => patch({ x: Number(event.currentTarget.value) })} />
        <InputField label="Y" type="number" value={Math.round(element.y)} isDisabled={disabled}
          onInputChange={(event) => patch({ y: Number(event.currentTarget.value) })} />
        <InputField label="W" type="number" value={Math.round(element.w)} isDisabled={disabled}
          onInputChange={(event) => patch({ w: Number(event.currentTarget.value) })} />
        <InputField label="H" type="number" value={Math.round(element.h)} isDisabled={disabled}
          onInputChange={(event) => patch({ h: Number(event.currentTarget.value) })} />
      </div>
    </Field.Set>

    {#if element.kind === 'text'}
      <Field.Separator />

      <Field.Set>
        <Field.Legend>{$t('course.navItem.certificates.editor.text')}</Field.Legend>

        <Field.Field>
          <textarea
            class="ui:border-input ui:bg-background w-full rounded-md border px-2 py-1.5 text-sm"
            rows="3"
            {disabled}
            value={element.content}
            oninput={(event) => patch({ content: (event.currentTarget as HTMLTextAreaElement).value })}
          ></textarea>
          <Field.Description>{$t('course.navItem.certificates.editor.bindings_hint')}</Field.Description>
        </Field.Field>

        <div class="flex flex-wrap gap-1">
          {#each BINDING_KEYS as key (key)}
            <Button variant="outline" size="sm" class="h-6 px-1.5 text-[10px]" {disabled} onclick={() => insertBinding(key)}>
              {$t(`course.navItem.certificates.editor.binding_${key}`)}
            </Button>
          {/each}
        </div>
      </Field.Set>

      <Field.Separator />

      <Field.Set>
        <Field.Legend>{$t('course.navItem.certificates.editor.typography')}</Field.Legend>

        <Field.Field>
          <select
            class="ui:border-input ui:bg-background w-full rounded-md border px-2 py-1.5 text-sm"
            {disabled}
            value={element.style.fontFamily}
            onchange={(event) => patchStyle({ fontFamily: (event.currentTarget as HTMLSelectElement).value })}
          >
            {#each FONT_FAMILIES as family (family)}
              <option value={family}>{family}</option>
            {/each}
          </select>
          <Field.Description>{$t('course.navItem.certificates.editor.fonts_hint')}</Field.Description>
        </Field.Field>

        <div class="grid grid-cols-2 gap-2">
          <InputField
            label={$t('course.navItem.certificates.editor.font_size')}
            type="number"
            value={element.style.fontSize}
            isDisabled={disabled}
            onInputChange={(event) => patchStyle({ fontSize: Number(event.currentTarget.value) })}
          />
          <Field.Field>
            <select
              class="ui:border-input ui:bg-background w-full rounded-md border px-2 py-1.5 text-sm"
              {disabled}
              value={String(element.style.fontWeight)}
              onchange={(event) => patchStyle({ fontWeight: Number((event.currentTarget as HTMLSelectElement).value) })}
            >
              {#each WEIGHTS as weight (weight)}
                <option value={String(weight)}>{weight}</option>
              {/each}
            </select>
          </Field.Field>
        </div>

        <div class="grid grid-cols-2 gap-2">
          <InputField
            label={$t('course.navItem.certificates.editor.line_height')}
            type="number"
            step="0.05"
            value={element.style.lineHeight}
            isDisabled={disabled}
            onInputChange={(event) => patchStyle({ lineHeight: Number(event.currentTarget.value) })}
          />
          <InputField
            label={$t('course.navItem.certificates.editor.letter_spacing')}
            type="number"
            step="0.5"
            value={element.style.letterSpacing}
            isDisabled={disabled}
            onInputChange={(event) => patchStyle({ letterSpacing: Number(event.currentTarget.value) })}
          />
        </div>

        <Field.Field>
          <label class="text-xs font-medium" for="element-color">
            {$t('course.navItem.certificates.editor.color')}
          </label>
          <input
            id="element-color"
            type="color"
            class="h-8 w-full cursor-pointer rounded-md border"
            {disabled}
            value={element.style.color}
            oninput={(event) => patchStyle({ color: (event.currentTarget as HTMLInputElement).value })}
          />
        </Field.Field>

        <div class="flex gap-1">
          {#each ['left', 'center', 'right'] as align (align)}
            <Button
              variant={element.style.align === align ? 'default' : 'outline'}
              size="sm"
              class="flex-1"
              {disabled}
              onclick={() => patchStyle({ align })}
            >
              {$t(`course.navItem.certificates.editor.align_${align}`)}
            </Button>
          {/each}
        </div>

        <div class="flex gap-1">
          <Button
            variant={element.style.italic ? 'default' : 'outline'}
            size="sm"
            class="flex-1 italic"
            {disabled}
            onclick={() => patchStyle({ italic: !element.style.italic })}
          >
            Aa
          </Button>
          <Button
            variant={element.style.uppercase ? 'default' : 'outline'}
            size="sm"
            class="flex-1"
            {disabled}
            onclick={() => patchStyle({ uppercase: !element.style.uppercase })}
          >
            AA
          </Button>
        </div>
      </Field.Set>

      <Field.Separator />

      <Field.Set>
        <Field.Legend>{$t('course.navItem.certificates.editor.fit_rule')}</Field.Legend>
        <div class="flex gap-1">
          {#each ['shrink', 'clamp', 'overflow'] as rule (rule)}
            <Button
              variant={element.fit === rule ? 'default' : 'outline'}
              size="sm"
              class="flex-1 text-[11px]"
              {disabled}
              onclick={() => patch({ fit: rule })}
            >
              {$t(`course.navItem.certificates.editor.fit_${rule}`)}
            </Button>
          {/each}
        </div>
        <Field.Description>
          {$t(`course.navItem.certificates.editor.fit_${element.fit}_hint`)}
        </Field.Description>

        {#if element.fit === 'shrink'}
          <InputField
            label={$t('course.navItem.certificates.editor.min_font_size')}
            type="number"
            value={element.minFontSize ?? 10}
            isDisabled={disabled}
            onInputChange={(event) => patch({ minFontSize: Number(event.currentTarget.value) })}
          />
        {:else if element.fit === 'clamp'}
          <InputField
            label={$t('course.navItem.certificates.editor.max_lines')}
            type="number"
            value={element.maxLines ?? 3}
            isDisabled={disabled}
            onInputChange={(event) => patch({ maxLines: Number(event.currentTarget.value) })}
          />
        {/if}
      </Field.Set>
    {:else if element.kind === 'shape'}
      <Field.Separator />

      <Field.Set>
        <Field.Legend>{$t('course.navItem.certificates.editor.shape')}</Field.Legend>
        <Field.Field>
          <label class="text-xs font-medium" for="shape-fill">
            {$t('course.navItem.certificates.editor.fill')}
          </label>
          <input
            id="shape-fill"
            type="color"
            class="h-8 w-full cursor-pointer rounded-md border"
            {disabled}
            value={element.fill ?? '#000000'}
            oninput={(event) => patch({ fill: (event.currentTarget as HTMLInputElement).value })}
          />
        </Field.Field>
      </Field.Set>
    {/if}

    <Field.Separator />

    <Field.Set>
      <Field.Legend>{$t('course.navItem.certificates.editor.transform')}</Field.Legend>
      <div class="grid grid-cols-2 gap-2">
        <InputField
          label={$t('course.navItem.certificates.editor.rotation')}
          type="number"
          value={element.rotation ?? 0}
          isDisabled={disabled}
          onInputChange={(event) => patch({ rotation: Number(event.currentTarget.value) })}
        />
        <InputField
          label={$t('course.navItem.certificates.editor.opacity')}
          type="number"
          step="0.05"
          value={element.opacity ?? 1}
          isDisabled={disabled}
          onInputChange={(event) => patch({ opacity: Number(event.currentTarget.value) })}
        />
      </div>
    </Field.Set>
  </Field.Group>
{/if}
