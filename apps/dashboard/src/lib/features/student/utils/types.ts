import { classroomio, type InferResponseType } from '$lib/utils/services/api';

export type GetStudentOverviewRequest = (typeof classroomio.student)[':profileId']['overview']['$get'];
export type GetStudentOverviewResponse = InferResponseType<GetStudentOverviewRequest>;
export type GetStudentOverviewSuccess = Extract<GetStudentOverviewResponse, { success: true }>;
export type StudentOverview = GetStudentOverviewSuccess['data'];
export type StudentOverviewCourse = StudentOverview['courses'][number];
export type StudentOverviewProgram = StudentOverview['programs'][number];
