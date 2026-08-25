import { BaseApiWithErrors, classroomio } from '$lib/utils/services/api';
import { snackbar } from '$features/ui/snackbar/store';

export interface EmailTemplateView {
  id: string;
  defaultSubject: string;
  defaultBody: string;
  variables: string[];
  requiredVariables: string[];
  subject: string | null;
  body: string | null;
  isCustomized: boolean;
}

class EmailTemplatesApi extends BaseApiWithErrors {
  templates = $state<EmailTemplateView[]>([]);
  loading = $state(false);
  saving = $state(false);

  async fetchTemplates() {
    this.loading = true;

    try {
      await this.execute({
        requestFn: () => classroomio.organization['email-templates'].$get(),
        logContext: 'fetching email templates',
        onSuccess: (response) => {
          this.templates = (response as { data: EmailTemplateView[] }).data;
        }
      });
    } finally {
      this.loading = false;
    }
  }

  async save(emailId: string, patch: { subject?: string | null; body?: string | null }) {
    this.saving = true;

    try {
      await this.execute({
        requestFn: () =>
          classroomio.organization['email-templates'][':emailId'].$put({
            param: { emailId },
            json: patch
          }),
        logContext: 'updating email template',
        onSuccess: (response) => {
          this.templates = (response as { data: EmailTemplateView[] }).data;
          snackbar.success('email_templates.saved');
        },
        onError: () => snackbar.error('email_templates.save_failed')
      });
    } finally {
      this.saving = false;
    }
  }

  async reset(emailId: string) {
    this.saving = true;

    try {
      await this.execute({
        requestFn: () =>
          classroomio.organization['email-templates'][':emailId'].$delete({ param: { emailId } }),
        logContext: 'resetting email template',
        onSuccess: (response) => {
          this.templates = (response as { data: EmailTemplateView[] }).data;
          snackbar.success('email_templates.reset_done');
        },
        onError: () => snackbar.error('email_templates.save_failed')
      });
    } finally {
      this.saving = false;
    }
  }
}

export const emailTemplatesApi = new EmailTemplatesApi();
