import { AppError, ErrorCodes } from '@api/utils/errors';

import { getCourseTeachers } from '@cio/db/queries/course/people';
import { getCourseWithOrgData } from '@cio/db/queries/course';
import { EMAIL_BRAND_NAME, buildEmailFromName } from '@cio/email';
import { isNotificationEnabled } from '@api/services/organization/notifications';
import { enqueueTransactionalEmail } from '@api/services/jobs';
import { trackServerEvent, SERVER_EVENTS } from '@cio/analytics';

export interface PaymentRequestData {
  courseId: string;
  studentEmail: string;
  studentFullname: string;
}

/**
 * Creates a payment request and sends emails to teacher and student
 * @param data Payment request data
 */
export async function createPaymentRequest(data: PaymentRequestData) {
  try {
    // Get course and organization data
    const course = await getCourseWithOrgData(data.courseId);

    if (!course) {
      throw new AppError('Course not found', ErrorCodes.NOT_FOUND, 404);
    }

    const courseName = course.courseTitle || '';
    const orgName = course.orgName || EMAIL_BRAND_NAME;
    const groupId = course.groupId;

    if (!groupId) {
      throw new AppError('Course group not found', ErrorCodes.NOT_FOUND, 404);
    }

    // Get first teacher (TUTOR or ADMIN) email
    const teacherResult = await getCourseTeachers({ groupId, limit: 1 });

    if (teacherResult.length === 0 || !teacherResult[0]?.email) {
      throw new AppError('No teacher found for this course', ErrorCodes.NOT_FOUND, 404);
    }

    const teacherEmail = teacherResult[0].email;

    try {
      if (await isNotificationEnabled(course.orgId, 'purchaseRequested')) {
        await enqueueTransactionalEmail('teacherStudentBuyRequest', {
          to: teacherEmail,
          fields: {
            courseName,
            studentEmail: data.studentEmail,
            studentFullname: data.studentFullname
          },
          from: buildEmailFromName(EMAIL_BRAND_NAME),
          idempotencyKey: `payment-request:teacher:${data.courseId}:${data.studentEmail}`
        });
      }
    } catch (emailError) {
      console.error('Failed to enqueue teacher buy request email:', emailError);
    }

    try {
      if (await isNotificationEnabled(course.orgId, 'paymentProofRequested')) {
        await enqueueTransactionalEmail('studentProvePayment', {
          to: data.studentEmail,
          fields: {
            courseName,
            teacherEmail,
            studentFullname: data.studentFullname,
            orgName
          },
          from: buildEmailFromName(orgName),
          replyTo: teacherEmail,
          idempotencyKey: `payment-request:student:${data.courseId}:${data.studentEmail}`
        });
      }
    } catch (emailError) {
      console.error('Failed to enqueue student payment proof email:', emailError);
    }

    trackServerEvent({
      eventType: SERVER_EVENTS.ENROLLMENT_STARTED,
      courseId: data.courseId,
      props: { path: 'payment-request', orgName }
    });

    return {
      success: true,
      courseName,
      teacherEmail
    };
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError(
      error instanceof Error ? error.message : 'Failed to create payment request',
      ErrorCodes.INTERNAL_ERROR,
      500
    );
  }
}
