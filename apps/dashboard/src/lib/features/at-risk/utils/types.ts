import { classroomio, type InferResponseType } from '$lib/utils/services/api';

export type GetAtRiskSettingsRequest = (typeof classroomio.organization)['at-risk']['$get'];
export type UpdateAtRiskSettingsRequest = (typeof classroomio.organization)['at-risk']['$put'];
export type GetAtRiskOverviewRequest = (typeof classroomio.organization)['at-risk']['overview']['$get'];

export type GetAtRiskSettingsSuccess = Extract<InferResponseType<GetAtRiskSettingsRequest>, { success: true }>;
export type AtRiskSettings = GetAtRiskSettingsSuccess['data'];

export type GetAtRiskOverviewSuccess = Extract<InferResponseType<GetAtRiskOverviewRequest>, { success: true }>;
export type AtRiskOverviewData = GetAtRiskOverviewSuccess['data'];

export type AtRiskLearnerRow = AtRiskOverviewData['learners'][number];
export type AtRiskReason = AtRiskLearnerRow['reasons'][number];
