<script lang="ts">
  /**
   * La plantilla propia: tu imagen de certificado, y dónde se imprime encima
   * cada uno de los quince campos.
   *
   * NO es un editor de diseño, y la diferencia es deliberada. El lienzo libre ya
   * se intentó y no cerró nunca: dejaba agregar, borrar y apilar cualquier cosa,
   * así que había que rediseñar un certificado entero para obtener uno que se
   * viera bien, y cualquier combinación podía quedar rota sin que nada lo
   * dijera. Acá el conjunto es cerrado — sólo se mueve, se muestra y se oculta
   * lo que el certificado siempre tuvo.
   */
  import * as Field from '@cio/ui/base/field';
  import { Button } from '@cio/ui/base/button';
  import { Switch } from '@cio/ui/base/switch';
  import ImageUpIcon from '@lucide/svelte/icons/image-up';
  import Trash2Icon from '@lucide/svelte/icons/trash-2';
  import LoaderIcon from '@lucide/svelte/icons/loader-circle';
  import RotateCcwIcon from '@lucide/svelte/icons/rotate-ccw';
  import { CERTIFICATE_FIELD_IDS, isImageField, type CertificateFieldId } from '@cio/certificates';
  import { uploadImage } from '$lib/utils/services/upload';
  import { snackbar } from '$features/ui/snackbar/store';
  import { t } from '$lib/utils/functions/translations';
  import { certificateEditorStore } from '../store/certificate-editor.store.svelte';

  interface Props {
    disabled?: boolean;
  }

  let { disabled = false }: Props = $props();

  const store = certificateEditorStore;
  const layout = $derived(store.draft.layout);
  const seleccionado = $derived(store.selectedFieldId);

  /** Las que el PDF ya carga. Una que no esté acá no se dibujaría. */
  const FUENTES = [
    'Cormorant Garamond',
    'Bodoni Moda',
    'Playfair Display',
    'Cinzel',
    'Archivo Black',
    'Space Grotesk',
    'DM Mono',
    'JetBrains Mono'
  ];

  /** Matches MAX_IMAGE_SIZE on the API; checked here so the trip is not wasted. */
  const MAX_BYTES = 5 * 1024 * 1024;

  let input = $state<HTMLInputElement | null>(null);
  let isUploading = $state(false);

  async function onPick(event: Event) {
    const file = (event.currentTarget as HTMLInputElement).files?.[0];
    if (!file) return;

    if (file.size > MAX_BYTES) {
      snackbar.error($t('course.navItem.certificates.editor.brand_logo_too_large'));
      if (input) input.value = '';

      return;
    }

    isUploading = true;

    try {
      store.setBackground(await uploadImage(file));
    } catch (error) {
      console.error('[certificate] background upload failed:', error);
      snackbar.error($t('course.navItem.certificates.editor.brand_logo_failed'));
    } finally {
      isUploading = false;
      if (input) input.value = '';
    }
  }

  function etiqueta(id: CertificateFieldId): string {
    return $t(`course.navItem.certificates.editor.field_${id}`);
  }
</script>

{#if !layout}
  <!-- La puerta de entrada. Sin esto la plantilla propia seria una funcion que
       existe pero que nadie encuentra. -->
  <Field.Field>
    <Field.Label>{$t('course.navItem.certificates.editor.own_template')}</Field.Label>
    <Field.Description>
      {$t('course.navItem.certificates.editor.own_template_hint')}
    </Field.Description>
    <Button type="button" variant="secondary" size="sm" {disabled} onclick={() => store.useOwnTemplate()}>
      {$t('course.navItem.certificates.editor.own_template_use')}
    </Button>
  </Field.Field>
{:else}
  <Field.Group>
    <Field.Set>
      <Field.Legend>{$t('course.navItem.certificates.editor.own_background')}</Field.Legend>

      <div class="flex items-center gap-3">
        <div
          class="ui:border-border flex h-16 w-24 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-white"
        >
          {#if layout.backgroundUrl}
            <img src={layout.backgroundUrl} alt="" class="h-full w-full object-contain" />
          {:else}
            <ImageUpIcon class="size-4 text-zinc-400" />
          {/if}
        </div>

        <div class="flex min-w-0 flex-col gap-1.5">
          <div class="flex gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={disabled || isUploading}
              onclick={() => input?.click()}
            >
              {#if isUploading}
                <LoaderIcon size={14} class="mr-1.5 animate-spin" />
              {/if}
              {layout.backgroundUrl
                ? $t('course.navItem.certificates.editor.brand_logo_replace')
                : $t('course.navItem.certificates.editor.own_background_upload')}
            </Button>
            {#if layout.backgroundUrl}
              <Button type="button" variant="ghost" size="sm" {disabled} onclick={() => store.setBackground('')}>
                <Trash2Icon size={14} />
              </Button>
            {/if}
          </div>
          <p class="ui:text-muted-foreground text-xs">
            {$t('course.navItem.certificates.editor.own_background_hint')}
          </p>
        </div>
      </div>

      <Field.Field>
        <Field.Label for="bg-tone">{$t('course.navItem.certificates.editor.own_background_tone')}</Field.Label>
        <select
          id="bg-tone"
          {disabled}
          value={layout.backgroundTone ?? 'light'}
          onchange={(event) => store.setBackgroundTone(event.currentTarget.value as 'light' | 'dark')}
          class="ui:border-input ui:bg-background h-9 w-full rounded-md border px-3 text-sm"
        >
          <option value="light">{$t('course.navItem.certificates.editor.own_background_tone_light')}</option>
          <option value="dark">{$t('course.navItem.certificates.editor.own_background_tone_dark')}</option>
        </select>
        <Field.Description>
          {$t('course.navItem.certificates.editor.own_background_tone_hint')}
        </Field.Description>
      </Field.Field>
    </Field.Set>

    <Field.Separator />

    <Field.Set>
      <Field.Legend>{$t('course.navItem.certificates.editor.own_fields')}</Field.Legend>
      <Field.Description>
        {$t('course.navItem.certificates.editor.own_fields_hint')}
      </Field.Description>

      <div class="flex flex-col gap-0.5">
        {#each CERTIFICATE_FIELD_IDS as id (id)}
          {@const caja = store.fieldPlacement(id)}
          <div class="flex items-center gap-2 rounded-md px-2 py-1.5 {seleccionado === id ? 'ui:bg-accent' : ''}">
            <Switch
              checked={!caja.hidden}
              {disabled}
              onCheckedChange={(checked) => store.toggleField(id, !checked)}
              aria-label={etiqueta(id)}
            />
            <button
              type="button"
              class="min-w-0 flex-1 truncate text-left text-sm {caja.hidden ? 'ui:text-muted-foreground' : ''}"
              onclick={() => store.selectField(id)}
            >
              {etiqueta(id)}
            </button>
            <span class="ui:text-muted-foreground shrink-0 text-[10px] tabular-nums">
              {Math.round(caja.x)},{Math.round(caja.y)}
            </span>
          </div>
        {/each}
      </div>
    </Field.Set>

    {#if seleccionado}
      {@const caja = store.fieldPlacement(seleccionado)}
      <Field.Separator />

      <Field.Set>
        <Field.Legend>{etiqueta(seleccionado)}</Field.Legend>
        <Field.Description>
          {$t('course.navItem.certificates.editor.own_field_drag_hint')}
        </Field.Description>

        {#if !isImageField(seleccionado)}
          <!-- Los campos de imagen no llevan tipografia: ofrecerla seria ofrecer
               ajustes que no hacen nada. -->
          <Field.Field>
            <Field.Label for="f-size">
              {$t('course.navItem.certificates.editor.own_field_size')}
              <span class="ui:text-muted-foreground ml-1 font-normal">{caja.fontSize ?? 16}px</span>
            </Field.Label>
            <input
              id="f-size"
              type="range"
              min="6"
              max="90"
              {disabled}
              value={caja.fontSize ?? 16}
              oninput={(event) => store.updateField(seleccionado, { fontSize: Number(event.currentTarget.value) })}
              class="w-full"
            />
          </Field.Field>

          <Field.Field>
            <Field.Label for="f-font">{$t('course.navItem.certificates.editor.own_field_font')}</Field.Label>
            <select
              id="f-font"
              {disabled}
              value={caja.fontFamily ?? 'Cormorant Garamond'}
              onchange={(event) => store.updateField(seleccionado, { fontFamily: event.currentTarget.value })}
              class="ui:border-input ui:bg-background h-9 w-full rounded-md border px-3 text-sm"
            >
              {#each FUENTES as familia (familia)}
                <option value={familia}>{familia}</option>
              {/each}
            </select>
          </Field.Field>

          <Field.Field>
            <Field.Label for="f-color">{$t('course.navItem.certificates.editor.own_field_color')}</Field.Label>
            <input
              id="f-color"
              type="color"
              {disabled}
              value={caja.color ?? (layout.backgroundTone === 'dark' ? '#f2efe9' : '#1a1a1a')}
              oninput={(event) => store.updateField(seleccionado, { color: event.currentTarget.value })}
              class="ui:border-input h-9 w-16 rounded-md border"
            />
          </Field.Field>

          <Field.Field>
            <Field.Label for="f-align">{$t('course.navItem.certificates.editor.own_field_align')}</Field.Label>
            <select
              id="f-align"
              {disabled}
              value={caja.align ?? 'center'}
              onchange={(event) =>
                store.updateField(seleccionado, {
                  align: event.currentTarget.value as 'left' | 'center' | 'right'
                })}
              class="ui:border-input ui:bg-background h-9 w-full rounded-md border px-3 text-sm"
            >
              <option value="left">{$t('course.navItem.certificates.editor.own_field_align_left')}</option>
              <option value="center">{$t('course.navItem.certificates.editor.own_field_align_center')}</option>
              <option value="right">{$t('course.navItem.certificates.editor.own_field_align_right')}</option>
            </select>
          </Field.Field>

          <Field.Field orientation="horizontal">
            <Switch
              checked={caja.bold ?? false}
              {disabled}
              onCheckedChange={(checked) => store.updateField(seleccionado, { bold: checked })}
            />
            <Field.Label>{$t('course.navItem.certificates.editor.own_field_bold')}</Field.Label>
          </Field.Field>
          <Field.Field orientation="horizontal">
            <Switch
              checked={caja.italic ?? false}
              {disabled}
              onCheckedChange={(checked) => store.updateField(seleccionado, { italic: checked })}
            />
            <Field.Label>{$t('course.navItem.certificates.editor.own_field_italic')}</Field.Label>
          </Field.Field>
          <Field.Field orientation="horizontal">
            <Switch
              checked={caja.uppercase ?? false}
              {disabled}
              onCheckedChange={(checked) => store.updateField(seleccionado, { uppercase: checked })}
            />
            <Field.Label>{$t('course.navItem.certificates.editor.own_field_uppercase')}</Field.Label>
          </Field.Field>
        {/if}

        <Button type="button" variant="ghost" size="sm" {disabled} onclick={() => store.resetField(seleccionado)}>
          <RotateCcwIcon size={14} class="mr-1.5" />
          {$t('course.navItem.certificates.editor.own_field_reset')}
        </Button>
      </Field.Set>
    {/if}

    <Field.Separator />

    <Button type="button" variant="ghost" size="sm" {disabled} onclick={() => store.useFixedTemplate()}>
      {$t('course.navItem.certificates.editor.own_template_leave')}
    </Button>
  </Field.Group>
{/if}

<input
  bind:this={input}
  type="file"
  accept="image/svg+xml,image/png,image/webp,image/jpeg"
  class="hidden"
  {disabled}
  onchange={onPick}
  aria-label={$t('course.navItem.certificates.editor.own_background')}
/>
