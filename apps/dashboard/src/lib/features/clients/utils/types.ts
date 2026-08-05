import { classroomio, type InferResponseType } from '$lib/utils/services/api';

export type ClientsOverviewRequest = typeof classroomio.organization.clients.overview.$get;

type OverviewSuccess = Extract<InferResponseType<ClientsOverviewRequest>, { success: true }>;

export type ClientsOverview = OverviewSuccess['data'];
export type ClientCompany = ClientsOverview['clients'][number];
