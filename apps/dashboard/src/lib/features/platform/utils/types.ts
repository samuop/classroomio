import { classroomio, type InferResponseType } from '$lib/utils/services/api';

export type ListPlatformOrgsRequest = typeof classroomio.platform.organizations.$get;
export type CreatePlatformOrgRequest = typeof classroomio.platform.organizations.$post;
export type GetPlatformOrgRequest = (typeof classroomio.platform.organizations)[':orgId']['$get'];
export type UpdatePlatformOrgRequest = (typeof classroomio.platform.organizations)[':orgId']['$put'];
export type SuspendPlatformOrgRequest = (typeof classroomio.platform.organizations)[':orgId']['suspend']['$post'];
export type SetPlatformOrgPlanRequest = (typeof classroomio.platform.organizations)[':orgId']['plan']['$put'];
export type PlatformDomainRequest = (typeof classroomio.platform.organizations)[':orgId']['domain']['$post'];

export type PlatformPlanName = 'BASIC' | 'EARLY_ADOPTER' | 'ENTERPRISE';

type ListSuccess = Extract<InferResponseType<ListPlatformOrgsRequest>, { success: true }>;
type DetailSuccess = Extract<InferResponseType<GetPlatformOrgRequest>, { success: true }>;

export type PlatformOrgList = ListSuccess['data'];
export type PlatformOrg = PlatformOrgList[number];
export type PlatformOrgsPagination = ListSuccess['pagination'];
export type PlatformOrgDetail = DetailSuccess['data'];
export type PlatformDomainAction = 'connect' | 'refresh' | 'remove';

export type PlatformOrgSortBy = 'createdAt' | 'name' | 'tokens';
export type PlatformOrgSortOrder = 'asc' | 'desc';
