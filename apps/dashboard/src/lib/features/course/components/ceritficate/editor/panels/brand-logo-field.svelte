<script lang="ts">
  /**
   * A logo for one of the certificate's two marks.
   *
   * Uploads rather than asking for a URL. The URL field this replaces was
   * technically enough — the renderer only ever wanted a string — but it asked a
   * teacher to already have their client's logo hosted somewhere public and
   * permanent, which nobody does. What they have is a file.
   *
   * SVG is offered first and on purpose: it has no background to clash with the
   * certificate, and it stays sharp when the PDF is rendered at export
   * resolution. The API sanitises every SVG before storing it.
   */
  import * as Field from '@cio/ui/base/field';
  import { Button } from '@cio/ui/base/button';
  import ImageUpIcon from '@lucide/svelte/icons/image-up';
  import Trash2Icon from '@lucide/svelte/icons/trash-2';
  import LoaderIcon from '@lucide/svelte/icons/loader-circle';
  import { uploadImage } from '$lib/utils/services/upload';
  import { snackbar } from '$features/ui/snackbar/store';
  import { t } from '$lib/utils/functions/translations';

  interface Props {
    label: string;
    /** The stored public URL; empty means this mark prints its name as text. */
    value: string;
    onChange: (url: string) => void;
    /** Shown behind the logo, so a white wordmark is not invisible on white. */
    preview?: 'light' | 'dark';
    disabled?: boolean;
  }

  let { label, value, onChange, preview = 'light', disabled = false }: Props = $props();

  const ACCEPT = 'image/svg+xml,image/png,image/webp,image/jpeg';
  /** Matches MAX_IMAGE_SIZE on the API; checked here so the trip is not wasted. */
  const MAX_BYTES = 5 * 1024 * 1024;

  let input = $state<HTMLInputElement | null>(null);
  let isUploading = $state(false);

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
      console.error('[certificate] logo upload failed:', error);
      snackbar.error($t('course.navItem.certificates.editor.brand_logo_failed'));
    } finally {
      isUploading = false;
      // Cleared so picking the SAME file again still fires a change event —
      // the obvious thing to do after a failed upload.
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
      class="ui:border-border flex h-14 w-24 shrink-0 items-center justify-center overflow-hidden rounded-md border {preview ===
      'dark'
        ? 'bg-zinc-900'
        : 'bg-white'}"
    >
      {#if value}
        <img src={value} alt="" class="max-h-12 max-w-20 object-contain" />
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
            ? $t('course.navItem.certificates.editor.brand_logo_replace')
            : $t('course.navItem.certificates.editor.brand_logo_upload')}
        </Button>

        {#if value}
          <Button type="button" variant="ghost" size="sm" {disabled} onclick={() => onChange('')}>
            <Trash2Icon size={14} />
          </Button>
        {/if}
      </div>

      <p class="ui:text-muted-foreground text-xs">
        {$t('course.navItem.certificates.editor.brand_logo_hint')}
      </p>
    </div>
  </div>

  <input
    bind:this={input}
    type="file"
    accept={ACCEPT}
    class="hidden"
    {disabled}
    onchange={onPick}
    aria-label={label}
  />
</Field.Field>
