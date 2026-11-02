<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { MarksPage } from '$features/course/pages';
  import * as Page from '@cio/ui/base/page';
  import { RoleBasedSecurity } from '$features/ui';
  import { t } from '$lib/utils/functions/translations';
  import type { AccountOrg } from '$features/app/types';
  import { currentOrg } from '$lib/utils/store/org';
  import { Button } from '@cio/ui/base/button';
  import DownloadIcon from '@lucide/svelte/icons/download';
  import * as DropdownMenu from '@cio/ui/base/dropdown-menu';
  import { descargarReporteDeAlumnos } from '$features/course/utils/course-report';
  import { snackbar } from '$features/ui/snackbar/store';
  import { RefreshPageData } from '$features/ui';
  import type { TCourseReportFormat } from '@cio/utils/validation/course';

  let { data } = $props();

  let isDownloading = $state(false);

  function getPageRoles(org: AccountOrg) {
    const roles = [1, 2];
    if (org.customization?.course?.grading) {
      roles.push(3);
    }
    return roles;
  }

  async function descargar(format: TCourseReportFormat) {
    if (!data.courseId || isDownloading) return;

    isDownloading = true;
    try {
      if (!(await descargarReporteDeAlumnos(data.courseId, format))) {
        snackbar.error('course.navItem.marks.export.failed');
      }
    } catch {
      snackbar.error('course.navItem.marks.export.failed');
    } finally {
      isDownloading = false;
    }
  }
</script>

<RoleBasedSecurity
  allowedRoles={getPageRoles($currentOrg)}
  onDenied={() => {
    goto(resolve(`/courses/${data.courseId}/lessons?next=true`, {}));
  }}
>
  <!-- Todo el ancho del área de contenido: una tabla con una columna por ejercicio no entraba en 3xl
       y el examen final quedaba fuera de la vista. -->
  <Page.Root class="mx-auto flex w-full max-w-7xl min-w-0 px-4 lg:px-8">
    <Page.Header>
      <Page.HeaderContent>
        <Page.Title>
          {$t('course.navItem.marks.title')}
        </Page.Title>
      </Page.HeaderContent>
      <Page.Action>
        <div class="flex w-full justify-end gap-2">
          <RoleBasedSecurity allowedRoles={[1, 2]}>
            <DropdownMenu.Root>
              <DropdownMenu.Trigger>
                {#snippet child({ props })}
                  <Button {...props} variant="outline" loading={isDownloading}>
                    <DownloadIcon size={16} />
                    {$t('course.navItem.marks.export.button')}
                  </Button>
                {/snippet}
              </DropdownMenu.Trigger>
              <DropdownMenu.Content align="end">
                <DropdownMenu.Item onclick={() => descargar('xlsx')}>
                  {$t('course.navItem.marks.export.report_xlsx')}
                </DropdownMenu.Item>
                <DropdownMenu.Item onclick={() => descargar('pdf')}>
                  {$t('course.navItem.marks.export.report_pdf')}
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Root>
          </RoleBasedSecurity>
          <RefreshPageData />
        </div>
      </Page.Action>
    </Page.Header>

    <Page.Body>
      {#snippet child()}
        <MarksPage marksData={data.marksData} />
      {/snippet}
    </Page.Body>
  </Page.Root>
</RoleBasedSecurity>
