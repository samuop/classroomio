<script lang="ts">
  import { page } from '$app/state';
  import { Spinner } from '@cio/ui/base/spinner';
  import { t } from '$lib/utils/functions/translations';
  import { courseApi } from '$features/course/api';
  import { profile } from '$lib/utils/store/user';
  import CertificateEditor from '$features/course/components/ceritficate/editor/certificate-editor.svelte';
  import { FONTS_LINK_HREF } from '@cio/certificates';

  const courseId = $derived(page.params.id ?? '');

  $effect(() => {
    if (!courseId || !$profile.id) return;
    courseApi.ensureCourse(courseId, $profile.id);
  });

  const isReady = $derived(courseApi.course?.id === courseId);
</script>

<svelte:head>
  <title>{courseApi.course?.title ?? $t('course.navItem.certificates.editor.title')}</title>
  <!--
    Las MISMAS tipografías que el certificado emitido, cargadas en la página.

    La vista previa es un iframe y trae este link en su propio `<head>`; el
    lienzo editable se dibuja acá adentro y no lo tenía, así que caía a la
    tipografía de reserva: se editaba en Georgia y se imprimía en Bodoni. Además
    de verse distinto, el motor de ajuste mide con OTRAS métricas, o sea que lo
    que entraba en la caja al editar podía no entrar al imprimir.

    Va en la RUTA y no en el editor: `svelte:head` dentro de un `{#if}` no se
    aplica, y el editor entero cuelga de uno.
  -->
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
  <link rel="stylesheet" href={FONTS_LINK_HREF} />
</svelte:head>

<div class="ui:bg-background min-h-screen w-full">
  {#if isReady}
    <CertificateEditor {courseId} />
  {:else}
    <div class="flex min-h-[60vh] items-center justify-center">
      <Spinner class="size-8!" />
    </div>
  {/if}
</div>
