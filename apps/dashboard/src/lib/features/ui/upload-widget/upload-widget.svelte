<script lang="ts">
  /**
   * La imagen de portada, subida desde la computadora.
   *
   * Tenía una segunda pestaña que buscaba fotos en Unsplash, y la buscaba apenas
   * se abría el diálogo: en producción la búsqueda no tenía clave, así que cada
   * vez que una docente abría el cargador le saltaba un error. Se sacó el
   * 2026-09-30.
   */
  import { snackbar } from '$features/ui/snackbar/store';
  import * as Dialog from '@cio/ui/base/dialog';
  import { handleOpenWidget } from '$features/ui/course-landing-page/store';

  import { t } from '$lib/utils/functions/translations';
  import { uploadImage } from '$lib/utils/services/upload';
  import * as FileDropZone from '@cio/ui/custom/file-drop-zone';
  import type { FileRejectedReason } from '@cio/ui/custom/file-drop-zone';

  interface Props {
    imageURL?: string;
    onchange?: (_v: string) => void;
  }

  let { imageURL = $bindable(''), onchange }: Props = $props();

  let isUploading = $state(false);

  const MAX_IMAGE_SIZE = 500 * FileDropZone.KILOBYTE;

  async function handleFilesUpload(files: File[]) {
    const file = files[0];
    if (file) await handleUploadImage(file);
  }

  function handleFileRejected({ reason }: { reason: FileRejectedReason }) {
    if (reason === 'Maximum file size exceeded') {
      snackbar.error('snackbar.landing_page_settings.error.file_size');
    } else {
      snackbar.error('snackbar.landing_page_settings.error.file_size');
    }
  }

  const handleUploadImage = async (image: File) => {
    isUploading = true;
    if (!image) {
      return;
    }

    imageURL = await uploadImage(image);

    onchange?.(imageURL);
    isUploading = false;

    snackbar.success(`snackbar.landing_page_settings.success.complete`);
    $handleOpenWidget.open = false;
  };
</script>

<Dialog.Root
  bind:open={$handleOpenWidget.open}
  onOpenChange={(isOpen) => {
    if (!isOpen) $handleOpenWidget.open = false;
  }}
>
  <Dialog.Content class="ui:z-300! w-3/5">
    <Dialog.Header>
      <Dialog.Title>{$t('course.navItem.landing_page.upload_widget.title')}</Dialog.Title>
    </Dialog.Header>
    <div class="w-full bg-white p-2 dark:bg-inherit {isUploading ? 'ui:opacity-50 ui:pointer-events-none' : ''}">
      <FileDropZone.Root
        accept={FileDropZone.ACCEPT_IMAGE}
        maxFiles={1}
        fileCount={0}
        maxFileSize={MAX_IMAGE_SIZE}
        onUpload={handleFilesUpload}
        onFileRejected={handleFileRejected}
      >
        <FileDropZone.Trigger
          label={$t('course.navItem.landing_page.upload_widget.drag_drop')}
          formatMaxSize={(_size) => $t('course.navItem.landing_page.upload_widget.size')}
        />
      </FileDropZone.Root>
    </div>
  </Dialog.Content>
</Dialog.Root>
