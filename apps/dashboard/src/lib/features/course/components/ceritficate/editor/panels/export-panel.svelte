<script lang="ts">
  import { Button } from '@cio/ui/base/button';
  import DownloadIcon from '@lucide/svelte/icons/download';
  import ImageIcon from '@lucide/svelte/icons/image';
  import PrinterIcon from '@lucide/svelte/icons/printer';
  import { t } from '$lib/utils/functions/translations';
  import { classroomio } from '$lib/utils/services/api';
  import { snackbar } from '$features/ui/snackbar/store';
  import { profile } from '$lib/utils/store/user';

  interface Props {
    courseId: string;
    courseTitle: string;
    disabled?: boolean;
  }

  let { courseId, courseTitle, disabled = false }: Props = $props();

  let isPdfLoading = $state(false);
  let isPngLoading = $state(false);
  let isPrintLoading = $state(false);

  const downloadName = $derived((courseTitle || 'certificate').replace(/\s+/g, '-').toLowerCase());

  async function buildBody() {
    return {
      studentName: $profile.fullname || 'Preview Recipient',
      studentId: $profile.id || undefined,
      issuedAt: new Date().toISOString(),
      previewMode: true
    } as const;
  }

  /**
   * What the server actually said, rather than "could not generate".
   *
   * Exporting goes through Cloudflare Browser Rendering, so it fails for
   * reasons a teacher cannot guess at and an operator can fix in a minute —
   * missing credentials, an expired key, an outage. The API now reports those
   * precisely; throwing that away and printing a fixed sentence turns a
   * five-minute fix into a bug report.
   *
   * `ApiError` carries the `Response`, and for a 5xx the client rejects on the
   * status without reading the body, so the body is still there to read.
   */
  async function describeFailure(error: unknown): Promise<string> {
    const response = (error as { response?: Response } | null)?.response;

    if (response) {
      try {
        const text = await response.text();
        const parsed = text.trim().startsWith('{') ? JSON.parse(text) : null;
        const detail = (parsed?.error ?? parsed?.message ?? text ?? '').toString().trim();

        if (detail) return detail.slice(0, 300);
      } catch {
        // The body was already consumed, or is not text. Fall through.
      }
    }

    return error instanceof Error && error.message ? error.message : '';
  }

  async function reportFailure(context: string, error: unknown) {
    console.error(context, error);

    const detail = await describeFailure(error);

    snackbar.error(
      detail
        ? t.get('course.navItem.certificates.editor.export_failed_detail', { detail })
        : 'course.navItem.certificates.editor.preview_failed'
    );
  }

  async function downloadPdf() {
    if (disabled || isPdfLoading) return;
    isPdfLoading = true;

    try {
      const body = await buildBody();
      const response = await classroomio.course[':courseId']['download']['certificate']['$post']({
        param: { courseId },
        json: body
      });
      const blob = await response.blob();
      triggerDownload(new Blob([blob], { type: 'application/pdf' }), `${downloadName}.pdf`);
    } catch (error) {
      await reportFailure('Preview PDF error', error);
    } finally {
      isPdfLoading = false;
    }
  }

  async function downloadPng() {
    if (disabled || isPngLoading) return;
    isPngLoading = true;

    try {
      const body = await buildBody();
      const response = await classroomio.course[':courseId']['download']['certificate']['png']['$post']({
        param: { courseId },
        json: body
      });
      const blob = await response.blob();
      triggerDownload(new Blob([blob], { type: 'image/png' }), `${downloadName}.png`);
    } catch (error) {
      await reportFailure('Preview PNG error', error);
    } finally {
      isPngLoading = false;
    }
  }

  async function print() {
    if (disabled || isPrintLoading) return;
    isPrintLoading = true;

    try {
      const body = await buildBody();
      const response = await classroomio.course[':courseId']['download']['certificate']['png']['$post']({
        param: { courseId },
        json: body
      });
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const printWindow = window.open('', '_blank');
      if (printWindow) {
        printWindow.document.write(
          `<!doctype html><html><head><title>${courseTitle}</title>` +
            `<style>@page{size:A4 landscape;margin:0}body{margin:0;display:flex;align-items:center;justify-content:center;background:#fff}img{width:100vw;max-width:1100px;height:auto}</style>` +
            `</head><body><img alt="" src="${url}" onload="setTimeout(()=>window.print(),300)"></body></html>`
        );
        printWindow.document.close();
      }
    } catch (error) {
      await reportFailure('Preview print error', error);
    } finally {
      isPrintLoading = false;
    }
  }

  function triggerDownload(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }
</script>

<div class="space-y-2">
  <Button class="w-full justify-start" {disabled} loading={isPdfLoading} onclick={downloadPdf}>
    <DownloadIcon class="size-4" />
    {$t('course.navItem.certificates.editor.download_pdf')}
  </Button>
  <Button variant="outline" class="w-full justify-start" {disabled} loading={isPngLoading} onclick={downloadPng}>
    <ImageIcon class="size-4" />
    {$t('course.navItem.certificates.editor.download_png')}
  </Button>
  <Button variant="outline" class="w-full justify-start" {disabled} loading={isPrintLoading} onclick={print}>
    <PrinterIcon class="size-4" />
    {$t('course.navItem.certificates.editor.print')}
  </Button>

  <p class="ui:text-muted-foreground mt-3 text-xs">
    {$t('course.navItem.certificates.editor.export_hint')}
  </p>
</div>
