<script lang="ts">
  import { Button } from '@cio/ui/base/button';
  import * as Dialog from '@cio/ui/base/dialog';
  import * as Field from '@cio/ui/base/field';
  import { Label } from '@cio/ui/base/label';
  import * as RadioGroup from '@cio/ui/base/radio-group';
  import type { TCoursePdfExercises, TCoursePdfScope } from '@cio/utils/validation/course';
  import { snackbar } from '$features/ui/snackbar/store';
  import { t } from '$lib/utils/functions/translations';
  import { classroomio } from '$lib/utils/services/api';

  interface Props {
    open: boolean;
    courseId: string;
  }

  let { open = $bindable(), courseId }: Props = $props();

  const KEY = 'course.navItem.settings.download_pdf';
  const SCOPES: TCoursePdfScope[] = ['outline', 'full'];
  const EXERCISES: TCoursePdfExercises[] = ['none', 'questions', 'answers'];

  let scope = $state<TCoursePdfScope>('outline');
  let exercises = $state<TCoursePdfExercises>('none');
  let isDownloading = $state(false);

  function fileName(response: Response): string {
    return response.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1] ?? 'curso.pdf';
  }

  async function download() {
    if (!courseId || isDownloading) return;

    isDownloading = true;
    try {
      const response = await classroomio.course[':courseId']['download']['pdf'].$get({
        param: { courseId },
        query: { scope, exercises }
      });

      if (!response.ok) {
        snackbar.error(`${KEY}.failed`);
        return;
      }

      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName(response);
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      open = false;
    } catch {
      snackbar.error(`${KEY}.failed`);
    } finally {
      isDownloading = false;
    }
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="w-[30rem] max-w-[calc(100vw-2rem)]">
    <Dialog.Header>
      <Dialog.Title>{$t(`${KEY}.title`)}</Dialog.Title>
      <Dialog.Description>{$t(`${KEY}.description`)}</Dialog.Description>
    </Dialog.Header>

    <Field.Field>
      <Field.Label>{$t(`${KEY}.scope_label`)}</Field.Label>
      <RadioGroup.Root bind:value={scope} class="space-y-2">
        {#each SCOPES as option (option)}
          <div class="flex items-start gap-2">
            <RadioGroup.Item value={option} id={`course-pdf-scope-${option}`} class="mt-0.5" />
            <div class="flex flex-col gap-1">
              <Label for={`course-pdf-scope-${option}`} class="font-normal">{$t(`${KEY}.scope_${option}`)}</Label>
              <span class="ui:text-muted-foreground text-xs">{$t(`${KEY}.scope_${option}_hint`)}</span>
            </div>
          </div>
        {/each}
      </RadioGroup.Root>
    </Field.Field>

    <Field.Field>
      <Field.Label>{$t(`${KEY}.exercises_label`)}</Field.Label>
      <RadioGroup.Root bind:value={exercises} class="space-y-2">
        {#each EXERCISES as option (option)}
          <div class="flex items-start gap-2">
            <RadioGroup.Item value={option} id={`course-pdf-exercises-${option}`} class="mt-0.5" />
            <div class="flex flex-col gap-1">
              <Label for={`course-pdf-exercises-${option}`} class="font-normal">{$t(`${KEY}.exercises_${option}`)}</Label>
              {#if option === 'answers'}
                <span class="ui:text-muted-foreground text-xs">{$t(`${KEY}.exercises_answers_hint`)}</span>
              {/if}
            </div>
          </div>
        {/each}
      </RadioGroup.Root>
    </Field.Field>

    <Dialog.Footer>
      <Button onclick={download} loading={isDownloading} disabled={isDownloading}>
        {$t(`${KEY}.submit`)}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
