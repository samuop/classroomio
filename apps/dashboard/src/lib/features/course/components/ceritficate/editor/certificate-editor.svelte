<script lang="ts">
  import {
    CERTIFICATE_TEMPLATES,
    STRESS_BINDING_VALUES,
    buildBindingValues,
    renderDocument,
    type CertificateTemplateId
  } from '@cio/certificates';
  import { Certificate } from '@cio/ui';
  import { IconButton } from '@cio/ui/custom/icon-button';
  import LayersIcon from '@lucide/svelte/icons/layers';
  import TypeIcon from '@lucide/svelte/icons/type';
  import PaletteIcon from '@lucide/svelte/icons/palette';
  import MousePointerIcon from '@lucide/svelte/icons/mouse-pointer-2';
  import DownloadIcon from '@lucide/svelte/icons/download';
  import FileImageIcon from '@lucide/svelte/icons/file-image';
  import { t } from '$lib/utils/functions/translations';

  import { courseApi } from '$features/course/api';
  import { currentOrg } from '$lib/utils/store/org';
  import { isFreePlan } from '$lib/utils/store/org';
  import { profile } from '$lib/utils/store/user';
  import CertificateEditorHeader from './certificate-editor-header.svelte';
  import TemplatesPanel from './panels/templates-panel.svelte';
  import ContentPanel from './panels/content-panel.svelte';
  import ElementPanel from './panels/element-panel.svelte';
  import LayoutPanel from './panels/layout-panel.svelte';
  import ColorsPanel from './panels/colors-panel.svelte';
  import ExportPanel from './panels/export-panel.svelte';
  import CanvasStage from './canvas/canvas-stage.svelte';
  import CanvasToolbar from './canvas/canvas-toolbar.svelte';
  import { certificateEditorStore, type CertificateEditorPanel } from './store/certificate-editor.store.svelte';

  let { courseId }: { courseId: string } = $props();

  const store = certificateEditorStore;

  $effect(() => {
    if (!courseApi.course?.id || courseApi.course.id !== courseId) return;
    store.syncFromCourse(courseId);
  });

  const courseTitle = $derived(courseApi.course?.title ?? '');

  const activeTemplateMeta = $derived(
    CERTIFICATE_TEMPLATES.find((tpl) => tpl.id === store.draft.templateId) ?? CERTIFICATE_TEMPLATES[0]
  );

  const previewDesign = $derived(store.toDesign());

  /**
   * Which data the canvas shows. The stress values are the whole reason the fit
   * contract exists: a teacher designing with their own short name has no other
   * way to discover that a long one runs over the seal.
   */
  let stressPreview = $state(false);

  const previewValues = $derived(
    stressPreview
      ? STRESS_BINDING_VALUES
      : // Quien firma también: sin pasarlo, `{{signatoryOneName}}` resuelve a
        // cadena vacía y los dos campos de firma salen INVISIBLES en el lienzo.
        // Ubicar un campo que no se ve es adivinar.
        buildBindingValues(sampleRenderData, store.draft.clientBrandName, store.draft.signatories)
  );

  /**
   * Ask the renderer — the same one that produces the PDF — which elements did
   * not fit, rather than re-deriving it in the editor. Two implementations of
   * "does this fit" would disagree, and the one that matters is the one that
   * prints.
   */
  const overflowingIds = $derived.by(() => {
    // El MISMO renderer que imprime, en las dos vías: en plantilla propia los
    // campos ya vienen compilados por el store, así que no hay una segunda idea
    // de "esto entra" que pueda discrepar con la que manda.
    const document = store.draft.layout
      ? { version: 2 as const, canvas: store.stageCanvas ?? { color: '#ffffff' }, elements: store.elements }
      : store.draft.document;

    if (!document) return [];

    return renderDocument({
      document,
      data: sampleRenderData,
      clientBrand: previewDesign.clientBrand,
      bindingOverrides: previewValues
    }).overflowingElementIds;
  });

  const sampleRenderData = $derived({
    recipientName: $profile.fullname || $t('course.navItem.certificates.editor.sample_recipient'),
    courseName: courseTitle || $t('course.navItem.certificates.editor.sample_course'),
    courseDescription:
      store.draft.descriptionOverride ||
      courseApi.course?.description ||
      $t('course.navItem.certificates.editor.sample_description'),
    orgName: $currentOrg.name || $t('course.navItem.certificates.editor.sample_org'),
    orgLogoUrl: $currentOrg.avatarUrl || undefined,
    // Matches the server's default in `formatCertificateDate`. The issued date
    // is formatted server-side (issuance has no browser to ask), so hardcoding
    // en-US here showed the teacher a preview in a different language from the
    // document their students receive.
    date: new Date().toLocaleDateString('es-AR', { year: 'numeric', month: 'long', day: 'numeric' }),
    certificateId: (store.draft.idFormat || 'N° {seq}').replace('{seq}', '0247')
  });

  function navVariant(panel: CertificateEditorPanel) {
    return store.activePanel === panel ? ('default' as const) : ('ghost' as const);
  }

  function setActive(panel: CertificateEditorPanel) {
    store.activePanel = panel;
  }
</script>

{#if courseApi.course?.id === courseId}
  <div class="ui:bg-background ui:text-foreground flex h-dvh flex-col">
    <CertificateEditorHeader
      {courseId}
      {courseTitle}
      templateLabel={activeTemplateMeta.label}
      isDirty={store.isDirty}
      isSaving={store.isSaving}
      isFreePlan={$isFreePlan}
      onSave={() => store.save()}
      onDiscard={() => store.reset()}
    />

    <div class="flex min-h-0 flex-1">
      <nav
        class="ui:border-border ui:bg-secondary flex w-14 shrink-0 flex-col items-center gap-1.5 border-r py-3"
        aria-label={$t('course.navItem.certificates.editor.sections')}
      >
        <IconButton
          type="button"
          variant={navVariant('templates')}
          tooltip={$t('course.navItem.certificates.editor.panel_templates')}
          tooltipSide="right"
          aria-label={$t('course.navItem.certificates.editor.panel_templates')}
          aria-current={store.activePanel === 'templates' ? 'page' : undefined}
          onclick={() => setActive('templates')}
        >
          <LayersIcon class="size-4" />
        </IconButton>
        <IconButton
          type="button"
          variant={navVariant('content')}
          tooltip={$t('course.navItem.certificates.editor.panel_content')}
          tooltipSide="right"
          aria-label={$t('course.navItem.certificates.editor.panel_content')}
          aria-current={store.activePanel === 'content' ? 'page' : undefined}
          onclick={() => setActive('content')}
        >
          <TypeIcon class="size-4" />
        </IconButton>
        {#if store.isCanvas}
          <IconButton
            type="button"
            variant={navVariant('element')}
            tooltip={$t('course.navItem.certificates.editor.panel_element')}
            tooltipSide="right"
            aria-label={$t('course.navItem.certificates.editor.panel_element')}
            aria-current={store.activePanel === 'element' ? 'page' : undefined}
            onclick={() => setActive('element')}
          >
            <MousePointerIcon class="size-4" />
          </IconButton>
        {/if}
        <IconButton
          type="button"
          variant={navVariant('layout')}
          tooltip={$t('course.navItem.certificates.editor.panel_layout')}
          tooltipSide="right"
          aria-label={$t('course.navItem.certificates.editor.panel_layout')}
          aria-current={store.activePanel === 'layout' ? 'page' : undefined}
          onclick={() => setActive('layout')}
        >
          <FileImageIcon class="size-4" />
        </IconButton>
        <IconButton
          type="button"
          variant={navVariant('colors')}
          tooltip={$t('course.navItem.certificates.editor.panel_colors')}
          tooltipSide="right"
          aria-label={$t('course.navItem.certificates.editor.panel_colors')}
          aria-current={store.activePanel === 'colors' ? 'page' : undefined}
          onclick={() => setActive('colors')}
        >
          <PaletteIcon class="size-4" />
        </IconButton>
        <IconButton
          type="button"
          variant={navVariant('export')}
          tooltip={$t('course.navItem.certificates.editor.panel_export')}
          tooltipSide="right"
          aria-label={$t('course.navItem.certificates.editor.panel_export')}
          aria-current={store.activePanel === 'export' ? 'page' : undefined}
          onclick={() => setActive('export')}
        >
          <DownloadIcon class="size-4" />
        </IconButton>
      </nav>

      <aside class="ui:border-border ui:bg-card flex w-[min(100%,380px)] shrink-0 flex-col border-r">
        <div class="ui:border-border border-b px-5 py-4">
          {#if store.activePanel === 'templates'}
            <h2 class="text-sm font-semibold">{$t('course.navItem.certificates.editor.panel_templates')}</h2>
            <p class="ui:text-muted-foreground mt-1 text-xs">
              {$t('course.navItem.certificates.editor.panel_templates_subtitle')}
            </p>
          {:else if store.activePanel === 'content'}
            <h2 class="text-sm font-semibold">{$t('course.navItem.certificates.editor.panel_content')}</h2>
            <p class="ui:text-muted-foreground mt-1 text-xs">
              {$t('course.navItem.certificates.editor.panel_content_subtitle')}
            </p>
          {:else if store.activePanel === 'element'}
            <h2 class="text-sm font-semibold">{$t('course.navItem.certificates.editor.panel_element')}</h2>
            <p class="ui:text-muted-foreground mt-1 text-xs">
              {$t('course.navItem.certificates.editor.panel_element_subtitle')}
            </p>
          {:else if store.activePanel === 'layout'}
            <h2 class="text-sm font-semibold">{$t('course.navItem.certificates.editor.panel_layout')}</h2>
            <p class="ui:text-muted-foreground mt-1 text-xs">
              {$t('course.navItem.certificates.editor.panel_layout_subtitle')}
            </p>
          {:else if store.activePanel === 'colors'}
            <h2 class="text-sm font-semibold">{$t('course.navItem.certificates.editor.panel_colors')}</h2>
            <p class="ui:text-muted-foreground mt-1 text-xs">
              {$t('course.navItem.certificates.editor.panel_colors_subtitle')}
            </p>
          {:else}
            <h2 class="text-sm font-semibold">{$t('course.navItem.certificates.editor.panel_export')}</h2>
            <p class="ui:text-muted-foreground mt-1 text-xs">
              {$t('course.navItem.certificates.editor.panel_export_subtitle')}
            </p>
          {/if}
        </div>

        <div class="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {#if store.activePanel === 'templates'}
            <TemplatesPanel
              value={store.draft.templateId}
              disabled={$isFreePlan}
              seed={{ data: sampleRenderData, values: previewValues }}
              onSelect={(id: CertificateTemplateId) =>
                store.setTemplate(id, { data: sampleRenderData, values: previewValues })}
            />
          {:else if store.activePanel === 'content'}
            <ContentPanel disabled={$isFreePlan} />
          {:else if store.activePanel === 'element'}
            <ElementPanel disabled={$isFreePlan} />
          {:else if store.activePanel === 'layout'}
            <LayoutPanel disabled={$isFreePlan} />
          {:else if store.activePanel === 'colors'}
            <ColorsPanel
              value={store.draft.accentColor}
              disabled={$isFreePlan}
              onSelect={(color) => store.setAccent(color)}
            />
          {:else}
            <ExportPanel {courseId} {courseTitle} disabled={$isFreePlan} />
          {/if}
        </div>
      </aside>

      <section
        class="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-auto bg-zinc-100 bg-[radial-gradient(circle,#d4d4d8_1px,transparent_1px)] [background-size:18px_18px] dark:bg-zinc-950 dark:bg-[radial-gradient(circle,rgba(113,113,122,0.4)_1px,transparent_1px)]"
        aria-label={$t('course.navItem.certificates.editor.preview')}
      >
        {#if store.isEditableStage}
          <div class="absolute top-3 left-1/2 z-10 -translate-x-1/2">
            <CanvasToolbar
              {stressPreview}
              onToggleStress={() => (stressPreview = !stressPreview)}
              overflowCount={overflowingIds.length}
              disabled={$isFreePlan}
            />
          </div>
        {/if}

        <div class="flex min-h-0 flex-1 items-center justify-center p-6 sm:p-10 lg:p-14">
          {#if store.isEditableStage}
            <!-- Editable surface instead of the read-only iframe. Both draw the
                 same document; this one can be grabbed. -->
            <CanvasStage values={previewValues} {overflowingIds} disabled={$isFreePlan} />
          {:else}
            <Certificate.Preview design={previewDesign} data={sampleRenderData} showControls />
          {/if}
        </div>
      </section>
    </div>
  </div>
{/if}
