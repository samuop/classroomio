<script lang="ts">
  import * as Field from '@cio/ui/base/field';
  import { Button } from '@cio/ui/base/button';
  import { TextareaField } from '@cio/ui/custom/textarea-field';
  import { CheckboxField } from '@cio/ui/custom/checkbox-field';
  import { t } from '$lib/utils/functions/translations';
  import { snackbar } from '$features/ui/snackbar/store';

  /**
   * `true` si salió bien (se vacía la lista); un texto, el error a mostrar debajo
   * de la lista; `false`, falló sin texto propio.
   */
  type InviteOutcome = boolean | string;

  interface Props {
    onInvite: (recipientCsv: string, sendEmail: boolean) => InviteOutcome | Promise<InviteOutcome>;
    titleKey?: string;
    descriptionKey?: string;
    submitKey?: string;
    noEmailsKey?: string;
  }

  let {
    onInvite,
    titleKey = 'course.navItem.people.invite_modal.invite_new_students_title',
    descriptionKey = 'course.navItem.people.invite_modal.invite_new_students_description',
    submitKey = 'course.navItem.people.invite_modal.invite_new_students',
    noEmailsKey = 'audience.import.snackbar_no_emails'
  }: Props = $props();

  let recipientCsv = $state('');
  let sendInviteEmails = $state(true);
  let isSubmitting = $state(false);
  let errorMessage = $state('');

  async function inviteStudents() {
    if (!recipientCsv.trim()) {
      snackbar.error(noEmailsKey);
      return;
    }

    isSubmitting = true;
    errorMessage = '';

    try {
      const outcome = await onInvite(recipientCsv, sendInviteEmails);

      // La lista se vacía SÓLO si salió bien. Se vaciaba siempre: con un correo
      // mal escrito no se invitaba a nadie y encima la lista desaparecía, sin
      // ningún aviso. Con cien correos pegados, eso es empezar de cero a ciegas.
      if (outcome === true) {
        recipientCsv = '';
      } else if (typeof outcome === 'string') {
        errorMessage = outcome;
      }
    } finally {
      isSubmitting = false;
    }
  }
</script>

<Field.Set>
  <Field.Legend>{$t(titleKey)}</Field.Legend>
  <Field.Description>{$t(descriptionKey)}</Field.Description>

  <Field.Group>
    <TextareaField
      label={$t('audience.import.emails_label')}
      bind:value={recipientCsv}
      rows={4}
      className="w-full"
      placeholder={$t('audience.import.emails_placeholder')}
      {errorMessage}
    />
    <CheckboxField name="send-invite-emails" label={$t('audience.import.send_email')} bind:checked={sendInviteEmails} />
  </Field.Group>

  <Button variant="secondary" onclick={inviteStudents} loading={isSubmitting}>
    {$t(submitKey)}
  </Button>
</Field.Set>
