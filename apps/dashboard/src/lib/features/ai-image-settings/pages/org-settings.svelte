<script lang="ts">
  import { onMount } from 'svelte';

  import * as Page from '@cio/ui/base/page';
  import { Button } from '@cio/ui/base/button';
  import { Textarea } from '@cio/ui/base/textarea';
  import { Label } from '@cio/ui/base/label';
  import ImageIcon from '@lucide/svelte/icons/image';
  import SparklesIcon from '@lucide/svelte/icons/sparkles';
  import TrashIcon from '@lucide/svelte/icons/trash-2';

  import { t } from '$lib/utils/functions/translations';
  import { uploadImage } from '$lib/utils/services/upload';
  import { snackbar } from '$features/ui/snackbar/store';
  import { aiImageApi } from '../api/ai-images.svelte';

  const MAX_NOTE = 400;

  let initialized = $state(false);
  let styleNote = $state('');
  let styleReferenceUrl = $state<string | null>(null);
  let uploading = $state(false);
  let fileInput = $state<HTMLInputElement>();

  const busy = $derived(aiImageApi.saving || uploading || aiImageApi.previewing);
  const dirty = $derived(
    initialized &&
      (styleNote !== (aiImageApi.settings?.styleNote ?? '') ||
        styleReferenceUrl !== (aiImageApi.settings?.styleReferenceUrl ?? null))
  );

  onMount(async () => {
    await aiImageApi.fetchSettings();
    styleNote = aiImageApi.settings?.styleNote ?? '';
    styleReferenceUrl = aiImageApi.settings?.styleReferenceUrl ?? null;
    initialized = true;
  });

  async function handleUpload(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;

    uploading = true;

    try {
      // Straight to the media bucket, which serves a public permanent URL — the
      // same requirement the generated images have, and for the same reason:
      // the model fetches it server-side on every generation.
      styleReferenceUrl = await uploadImage(file);
    } catch {
      snackbar.error('ai_images.error.upload');
    } finally {
      uploading = false;
      if (fileInput) fileInput.value = '';
    }
  }

  async function handleSave() {
    await aiImageApi.updateSettings({ styleNote, styleReferenceUrl });
  }

  async function handlePreview() {
    await aiImageApi.generatePreview({ styleNote, styleReferenceUrl });
  }
</script>

<Page.Root class="mx-auto flex w-[90%] px-4 md:max-w-2xl lg:max-w-3xl">
  <Page.Header isSticky class="ui:bg-background z-10">
    <Page.HeaderContent>
      <Page.Title>{$t('ai_images.page.title')}</Page.Title>
      <Page.Subtitle>{$t('ai_images.page.description')}</Page.Subtitle>
    </Page.HeaderContent>
    <Page.Action>
      <Button loading={aiImageApi.saving} disabled={busy || !initialized || !dirty} onclick={handleSave}>
        {$t('ai_images.action.save')}
      </Button>
    </Page.Action>
  </Page.Header>

  <Page.Body>
    {#snippet child()}
      {#if !initialized}
        <p class="ui:text-muted-foreground text-sm">{$t('ai_images.state.loading')}</p>
      {:else}
        <div class="flex flex-col gap-8 pb-10">
          <section class="flex flex-col gap-3">
            <div>
              <Label>{$t('ai_images.reference.label')}</Label>
              <p class="ui:text-muted-foreground mt-1 text-sm">{$t('ai_images.reference.help')}</p>
            </div>

            {#if styleReferenceUrl}
              <div class="flex flex-col gap-2">
                <img
                  src={styleReferenceUrl}
                  alt={$t('ai_images.reference.alt')}
                  class="ui:border-border w-full max-w-md rounded-md border object-cover"
                />
                <div class="flex gap-2">
                  <Button variant="outline" size="sm" disabled={busy} onclick={() => fileInput?.click()}>
                    {$t('ai_images.reference.replace')}
                  </Button>
                  <Button variant="ghost" size="sm" disabled={busy} onclick={() => (styleReferenceUrl = null)}>
                    <TrashIcon size={14} class="mr-1" />
                    {$t('ai_images.reference.remove')}
                  </Button>
                </div>
              </div>
            {:else}
              <Button variant="outline" class="w-fit" loading={uploading} disabled={busy} onclick={() => fileInput?.click()}>
                <ImageIcon size={15} class="mr-2" />
                {$t('ai_images.reference.upload')}
              </Button>
            {/if}

            <input
              bind:this={fileInput}
              type="file"
              accept="image/png, image/jpeg, image/webp"
              class="hidden"
              onchange={handleUpload}
            />
          </section>

          <section class="flex flex-col gap-3">
            <div>
              <Label for="style-note">{$t('ai_images.note.label')}</Label>
              <p class="ui:text-muted-foreground mt-1 text-sm">{$t('ai_images.note.help')}</p>
            </div>
            <Textarea
              id="style-note"
              bind:value={styleNote}
              maxlength={MAX_NOTE}
              rows={3}
              disabled={busy}
              placeholder={$t('ai_images.note.placeholder')}
            />
            <p class="ui:text-muted-foreground text-xs">{styleNote.length} / {MAX_NOTE}</p>
          </section>

          <section class="ui:border-border flex flex-col gap-3 border-t pt-6">
            <div>
              <Label>{$t('ai_images.preview.label')}</Label>
              <p class="ui:text-muted-foreground mt-1 text-sm">{$t('ai_images.preview.help')}</p>
            </div>

            <Button
              variant="outline"
              class="w-fit"
              loading={aiImageApi.previewing}
              disabled={busy}
              onclick={handlePreview}
            >
              <SparklesIcon size={15} class="mr-2" />
              {$t('ai_images.preview.action')}
            </Button>

            {#if aiImageApi.preview}
              <img
                src={aiImageApi.preview.url}
                alt={$t('ai_images.preview.alt')}
                class="ui:border-border w-full max-w-md rounded-md border"
              />
            {/if}
          </section>
        </div>
      {/if}
    {/snippet}
  </Page.Body>
</Page.Root>
