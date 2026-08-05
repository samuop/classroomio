import { BaseApiWithErrors, classroomio } from '$lib/utils/services/api';
import { copyCourseModal, copyCourseModalInitialState } from '../utils/store';

import type { CloneCourseRequest } from '../utils/types';
import type { TCourseClone } from '@cio/utils/validation/course';
import { ZCourseClone } from '@cio/utils/validation/course';
import { currentOrg } from '$lib/utils/store/org';
import { generateSlug } from '@cio/utils/functions';
import { get } from 'svelte/store';
import { goto } from '$app/navigation';
import { mapZodErrorsToTranslations } from '$lib/utils/validation';
import { resolve } from '$app/paths';
import { snackbar } from '$features/ui/snackbar/store';
import { t } from '$lib/utils/functions/translations';

/**
 * API class for course operations
 */
export class CourseCloneApi extends BaseApiWithErrors {
  /**
   * Clones a course
   * @param courseId The ID of the course to clone
   * @param title Course title
   * @param description Course description (optional)
   * @returns The cloned course data or null on error
   */
  async clone(
    courseId: string,
    title: string,
    description?: string,
    delivery?: { organizationId?: string; linkToMaster?: boolean }
  ) {
    // Generate unique slug from the title
    const slug = generateSlug(title, { appendTimestamp: true });

    // Prepare data for validation
    const data: TCourseClone = {
      title,
      description,
      slug,
      organizationId: delivery?.organizationId || get(currentOrg).id,
      linkToMaster: delivery?.linkToMaster ?? false
    };

    // Client-side validation
    const result = ZCourseClone.safeParse(data);
    if (!result.success) {
      this.errors = mapZodErrorsToTranslations(result.error, 'course');
      return null;
    }

    await this.execute<CloneCourseRequest>({
      requestFn: () =>
        classroomio.course[':courseId'].clone.$post({
          param: { courseId },
          json: result.data
        }),
      logContext: 'cloning course',
      onSuccess: (response) => {
        this.errors = {};

        copyCourseModal.set(copyCourseModalInitialState);
        copyCourseModal.update((modal) => ({ ...modal, open: false }));

        const deliveredElsewhere = data.organizationId !== get(currentOrg).id;

        if (deliveredElsewhere) {
          // The copy lives in another company, so the course route of the one
          // we are standing in would not find it. Say where it went instead of
          // navigating somewhere it is not.
          snackbar.success(t.get('courses.copy_course.success.course_delivered'));
          return;
        }

        goto(resolve(`/courses/${response.course.id}`, {}));

        snackbar.success(t.get('courses.copy_course.success.course_cloned'));
      },
      onError: (result) => {
        if (typeof result === 'string') {
          snackbar.error(result);
          return;
        }
        if ('error' in result && 'field' in result) {
          // Field-specific error automatically mapped to this.errors[field]
          this.errors[result.field as string] = result.error;
        } else if ('error' in result) {
          snackbar.error(result.error);
        }
      }
    });
  }
}

export const courseCloneApi = new CourseCloneApi();
