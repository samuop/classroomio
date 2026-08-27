<script lang="ts">
  /**
   * La firma escaneada de quien firma el certificado.
   *
   * Sube un archivo, como el logo de una marca, por la misma razón: nadie tiene
   * su firma publicada en una URL estable, tiene una foto.
   *
   * Lo que pregunta —y lo único— es si el archivo trae FONDO BLANCO. Es la
   * diferencia entre un trazo apoyado sobre el papel del certificado y un
   * parche blanco rectangular en medio del pie de página, y no se puede
   * adivinar mirando el archivo: un PNG opaco y uno recortado se ven igual acá
   * arriba de un fondo blanco. La tinta no se pregunta porque una firma siempre
   * es oscura — la plantilla la invierte sola sobre papel oscuro.
   */
  import * as Field from '@cio/ui/base/field';
  import { Button } from '@cio/ui/base/button';
  import { Switch } from '@cio/ui/base/switch';
  import ImageUpIcon from '@lucide/svelte/icons/image-up';
  import Trash2Icon from '@lucide/svelte/icons/trash-2';
  import LoaderIcon from '@lucide/svelte/icons/loader-circle';
  import { uploadImage } from '$lib/utils/services/upload';
  import { snackbar } from '$features/ui/snackbar/store';
  import { t } from '$lib/utils/functions/translations';
  import {
    DEFAULT_SIGNATURE_HEIGHT,
    DEFAULT_SIGNATURE_OFFSET,
    MAX_SIGNATURE_HEIGHT,
    MAX_SIGNATURE_OFFSET,
    MIN_SIGNATURE_HEIGHT,
    MIN_SIGNATURE_OFFSET
  } from '@cio/certificates';

  interface Props {
    label: string;
    value: string;
    hasBackground: boolean;
    /** `null` = como lo pone la plantilla. */
    height: number | null;
    offset: number | null;
    onChange: (url: string) => void;
    onBackgroundChange: (hasBackground: boolean) => void;
    onHeightChange: (height: number) => void;
    onOffsetChange: (offset: number) => void;
    /** El fondo de la plantilla, para que la vista previa no mienta. */
    surface?: 'light' | 'dark';
    disabled?: boolean;
  }

  let {
    label,
    value,
    hasBackground,
    height,
    offset,
    onChange,
    onBackgroundChange,
    onHeightChange,
    onOffsetChange,
    surface = 'light',
    disabled = false
  }: Props = $props();

  const ACCEPT = 'image/svg+xml,image/png,image/webp,image/jpeg';
  /** Matches MAX_IMAGE_SIZE on the API; checked here so the trip is not wasted. */
  const MAX_BYTES = 5 * 1024 * 1024;

  let input = $state<HTMLInputElement | null>(null);
  let isUploading = $state(false);

  /** Las MISMAS mezclas que hace el renderer, o la vista previa no sirve. */
  const estilo = $derived(
    [
      surface === 'dark' ? 'filter: invert(1)' : '',
      hasBackground ? `mix-blend-mode: ${surface === 'dark' ? 'screen' : 'multiply'}` : ''
    ]
      .filter(Boolean)
      .join('; ')
  );

  async function onPick(event: Event) {
    const file = (event.currentTarget as HTMLInputElement).files?.[0];
    if (!file) return;

    if (file.size > MAX_BYTES) {
      snackbar.error($t('course.navItem.certificates.editor.brand_logo_too_large'));
      resetInput();

      return;
    }

    isUploading = true;

    try {
      onChange(await uploadImage(file));
    } catch (error) {
      console.error('[certificate] signature upload failed:', error);
      snackbar.error($t('course.navItem.certificates.editor.brand_logo_failed'));
    } finally {
      isUploading = false;
      resetInput();
    }
  }

  function resetInput() {
    if (input) input.value = '';
  }
</script>

<Field.Field>
  <Field.Label>{label}</Field.Label>

  <div class="flex items-center gap-3">
    <div
      class="ui:border-border flex h-14 w-24 shrink-0 items-center justify-center overflow-hidden rounded-md border {surface ===
      'dark'
        ? 'bg-zinc-900'
        : 'bg-white'}"
    >
      {#if value}
        <img src={value} alt="" class="max-h-12 max-w-20 object-contain" style={estilo} />
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
          {value
            ? $t('course.navItem.certificates.editor.signature_replace')
            : $t('course.navItem.certificates.editor.signature_upload')}
        </Button>

        {#if value}
          <Button type="button" variant="ghost" size="sm" {disabled} onclick={() => onChange('')}>
            <Trash2Icon size={14} />
          </Button>
        {/if}
      </div>

      <p class="ui:text-muted-foreground text-xs">
        {$t('course.navItem.certificates.editor.signature_hint')}
      </p>
    </div>
  </div>

  {#if value}
    <!--
      Alto y altura sobre el renglón.
      Una firma escaneada trae su propio aire: un recorte ajustado queda flotando
      y una foto con margen queda hundida. Eso depende del ARCHIVO, así que no
      hay valor por defecto que le sirva a todos.
    -->
    <div class="grid grid-cols-2 gap-3">
      <Field.Field>
        <Field.Label for="sig-h-{label}">
          {$t('course.navItem.certificates.editor.signature_height')}
          <span class="ui:text-muted-foreground ml-1 font-normal">{height ?? DEFAULT_SIGNATURE_HEIGHT}px</span>
        </Field.Label>
        <input
          id="sig-h-{label}"
          type="range"
          min={MIN_SIGNATURE_HEIGHT}
          max={MAX_SIGNATURE_HEIGHT}
          {disabled}
          value={height ?? DEFAULT_SIGNATURE_HEIGHT}
          oninput={(event) => onHeightChange(Number(event.currentTarget.value))}
          class="w-full"
        />
      </Field.Field>

      <Field.Field>
        <Field.Label for="sig-o-{label}">
          {$t('course.navItem.certificates.editor.signature_offset')}
          <span class="ui:text-muted-foreground ml-1 font-normal">{offset ?? DEFAULT_SIGNATURE_OFFSET}px</span>
        </Field.Label>
        <input
          id="sig-o-{label}"
          type="range"
          min={MIN_SIGNATURE_OFFSET}
          max={MAX_SIGNATURE_OFFSET}
          {disabled}
          value={offset ?? DEFAULT_SIGNATURE_OFFSET}
          oninput={(event) => onOffsetChange(Number(event.currentTarget.value))}
          class="w-full"
        />
      </Field.Field>
    </div>
    <Field.Description>
      {$t('course.navItem.certificates.editor.signature_offset_hint')}
    </Field.Description>

    <Field.Field orientation="horizontal">
      <Switch checked={hasBackground} {disabled} onCheckedChange={(checked) => onBackgroundChange(checked)} />
      <Field.Label>{$t('course.navItem.certificates.editor.signature_has_background')}</Field.Label>
    </Field.Field>
    <Field.Description>
      {$t('course.navItem.certificates.editor.signature_has_background_hint')}
    </Field.Description>
  {/if}

  <input bind:this={input} type="file" accept={ACCEPT} class="hidden" {disabled} onchange={onPick} aria-label={label} />
</Field.Field>
