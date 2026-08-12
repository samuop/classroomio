import { classroomio, type InferResponseType } from '$lib/utils/services/api';

export type GetOrgAiImagesRequest = (typeof classroomio.organization)['ai-images']['$get'];
export type UpdateOrgAiImagesRequest = (typeof classroomio.organization)['ai-images']['$put'];
export type PreviewAiImageRequest = (typeof classroomio.organization)['ai-images']['preview']['$post'];

export type GetOrgAiImagesSuccess = Extract<InferResponseType<GetOrgAiImagesRequest>, { success: true }>;
export type OrgAiImageSettings = GetOrgAiImagesSuccess['data'];

export type PreviewAiImageSuccess = Extract<InferResponseType<PreviewAiImageRequest>, { success: true }>;
export type AiImagePreview = PreviewAiImageSuccess['data'];
