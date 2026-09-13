<script lang="ts">
  import * as Dialog from '@cio/ui/base/dialog';
  import { Button } from '@cio/ui/base/button';
  import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
  import LinkIcon from '@lucide/svelte/icons/link';
  import ImagePlusIcon from '@lucide/svelte/icons/image-plus';
  import { snackbar } from '$features/ui/snackbar/store';
  import { t } from '$lib/utils/functions/translations';

  /**
   * Una imagen adjunta, en grande.
   *
   * Lo que se puede hacer con ella sale de lo que el docente suele querer después
   * de mandarla: verla bien, llevarse el enlace, o pedir que vaya a la lección que
   * tiene abierta. Esto último es un mensaje más al asistente —con la dirección—,
   * no una edición directa: el lugar donde va lo decide el contenido.
   */
  interface Props {
    open: boolean;
    url: string;
    name: string;
    /** Pedirle al asistente que la ponga en la lección abierta. Sin esto no se ofrece. */
    onUseInLesson?: (url: string) => void;
  }

  let { open = $bindable(), url, name, onUseInLesson }: Props = $props();

  async function copiarEnlace() {
    try {
      await navigator.clipboard.writeText(url);
      snackbar.success(t.get('ai_assistant.attachments.link_copied'));
    } catch {
      // Sin permiso de portapapeles no hay nada que mostrar: el enlace sigue a la vista.
    }
  }

  function usarEnLaLeccion() {
    open = false;
    onUseInLesson?.(url);
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="max-w-3xl gap-3 p-3 sm:p-4">
    <Dialog.Title class="truncate pr-8 text-sm font-medium">{name}</Dialog.Title>

    <div class="flex max-h-[70vh] items-center justify-center overflow-auto rounded-lg bg-(--muted)/40">
      <img src={url} alt={$t('ai_assistant.attachments.image_alt', { name })} class="max-h-[70vh] max-w-full object-contain" />
    </div>

    <div class="flex flex-wrap items-center justify-end gap-2">
      <Button variant="ghost" size="sm" href={url} target="_blank" rel="noopener noreferrer">
        <ExternalLinkIcon size={14} />
        {$t('ai_assistant.attachments.open_new_tab')}
      </Button>
      <Button variant="ghost" size="sm" onclick={copiarEnlace}>
        <LinkIcon size={14} />
        {$t('ai_assistant.attachments.copy_link')}
      </Button>
      {#if onUseInLesson}
        <Button size="sm" onclick={usarEnLaLeccion}>
          <ImagePlusIcon size={14} />
          {$t('ai_assistant.attachments.use_in_lesson')}
        </Button>
      {/if}
    </div>
  </Dialog.Content>
</Dialog.Root>
