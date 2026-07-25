import { classroomio, type InferResponseType } from '$lib/utils/services/api';

export type GetTrackingOverviewRequest = (typeof classroomio.organization)['tracking']['overview']['$get'];

export type GetTrackingOverviewSuccess = Extract<
  InferResponseType<GetTrackingOverviewRequest>,
  { success: true }
>;
export type TrackingOverviewData = GetTrackingOverviewSuccess['data'];

export type TrackingStudentRow = TrackingOverviewData['byStudent'][number];
export type TrackingCourseRow = TrackingOverviewData['byCourse'][number];
export type TrackingStatus = TrackingStudentRow['status'];

/** Reading axis of the tracking hub. */
export type TrackingAxis = 'student' | 'course';
