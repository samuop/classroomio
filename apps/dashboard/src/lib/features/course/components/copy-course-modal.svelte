<script lang="ts">
  import { preventDefault } from '$lib/utils/functions/svelte';
  import { Button } from '@cio/ui/base/button';
  import { Checkbox } from '@cio/ui/base/checkbox';
  import * as Dialog from '@cio/ui/base/dialog';
  import * as Field from '@cio/ui/base/field';
  import * as RadioGroup from '@cio/ui/base/radio-group';
  import { InputField } from '@cio/ui/custom/input-field';
  import { Label } from '@cio/ui/base/label';
  import { TextareaField } from '@cio/ui/custom/textarea-field';
  import { ROLE } from '@cio/utils/constants';
  import { copyCourseModal } from '$features/course/utils/store';
  import { courseCloneApi } from '$features/course/api';
  import { currentOrg, orgs } from '$lib/utils/store/org';
  import { t } from '$lib/utils/functions/translations';

  /**
   * Where this course can be delivered: the company we are in, plus the client
   * companies of the same account this person administers. Copying into a
   * company you do not administer is refused by the server, so offering it here
   * would only be a dead end.
   */
  const accountRootId = $derived($currentOrg.parentOrganizationId ?? $currentOrg.id);

  const destinations = $derived(
    $orgs.filter(
      (org) =>
        (org.parentOrganizationId ?? org.id) === accountRootId &&
        (org.id === $currentOrg.id || org.roleId === ROLE.ADMIN)
    )
  );

  let destinationId = $state('');

  // Default to the company we are standing in, and reset it each time the
  // dialog opens so a previous delivery never picks the target for the next.
  $effect(() => {
    if ($copyCourseModal.open) destinationId = $currentOrg.id;
  });

  const isDelivery = $derived(Boolean(destinationId) && destinationId !== $currentOrg.id);

  let linkToMaster = $state(true);

  async function createCourse() {
    if ($copyCourseModal.isSaving || courseCloneApi.isLoading) return;

    await courseCloneApi.clone($copyCourseModal.id, $copyCourseModal.title, $copyCourseModal.description, {
      organizationId: destinationId || $currentOrg.id,
      // Only a delivery into another company can be kept tied to its master;
      // a copy beside the original has nothing to be updated from.
      linkToMaster: isDelivery && linkToMaster
    });
  }

  // Sync loading state with modal store
  $effect(() => {
    $copyCourseModal.isSaving = courseCloneApi.isLoading;
  });
</script>

<Dialog.Root bind:open={$copyCourseModal.open}>
  <Dialog.Content class="w-96">
    <Dialog.Header>
      <Dialog.Title>{$t('courses.copy_course.title')}</Dialog.Title>
    </Dialog.Header>
    <form onsubmit={preventDefault(createCourse)}>
      <InputField
        label={$t('courses.copy_course.course_name_label')}
        bind:value={$copyCourseModal.title}
        autoFocus={true}
        placeholder={$t('courses.copy_course.course_name_placeholder')}
        className="mb-4"
        isRequired={true}
        autoComplete={false}
        errorMessage={courseCloneApi.errors.title}
      />

      <TextareaField
        label={$t('courses.copy_course.course_description_label')}
        bind:value={$copyCourseModal.description}
        placeholder={$t('courses.copy_course.course_description_placeholder')}
        className="mb-4"
        rows={4}
        errorMessage={courseCloneApi.errors.description}
      />

      {#if destinations.length > 1}
        <Field.Field class="mb-4">
          <Field.Label>{$t('courses.copy_course.destination_label')}</Field.Label>
          <RadioGroup.Root bind:value={destinationId} class="space-y-2">
            {#each destinations as org (org.id)}
              <div class="flex items-center gap-2">
                <RadioGroup.Item value={org.id} id={`copy-dest-${org.id}`} />
                <Label for={`copy-dest-${org.id}`} class="font-normal">
                  {org.name}
                  {#if org.id === $currentOrg.id}
                    <span class="ui:text-muted-foreground text-xs">
                      {$t('courses.copy_course.destination_here')}
                    </span>
                  {/if}
                </Label>
              </div>
            {/each}
          </RadioGroup.Root>
          {#if courseCloneApi.errors.organizationId}
            <Field.Error>{courseCloneApi.errors.organizationId}</Field.Error>
          {/if}
        </Field.Field>

        {#if isDelivery}
          <Field.Field class="mb-4">
            <div class="flex items-start gap-2">
              <Checkbox id="copy-link-master" bind:checked={linkToMaster} />
              <Label for="copy-link-master" class="font-normal">
                {$t('courses.copy_course.link_to_master_label')}
              </Label>
            </div>
            <Field.Description>{$t('courses.copy_course.link_to_master_hint')}</Field.Description>
          </Field.Field>
        {/if}
      {/if}

      {#if courseCloneApi.errors.general}
        <div class="mb-4 text-sm text-red-600">{courseCloneApi.errors.general}</div>
      {/if}

      <div class="mt-5 flex flex-row-reverse items-center">
        <Button type="submit" loading={$copyCourseModal.isSaving}>
          {$t('courses.copy_course.create_button')}
        </Button>
      </div>
    </form>
  </Dialog.Content>
</Dialog.Root>
