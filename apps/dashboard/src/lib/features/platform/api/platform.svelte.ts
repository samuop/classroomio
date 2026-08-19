import type {
  CreatePlatformOrgRequest,
  GetPlatformOrgRequest,
  ListPlatformOrgsRequest,
  PlatformDomainAction,
  PlatformDomainRequest,
  PlatformOrg,
  PlatformOrgDetail,
  PlatformOrgList,
  PlatformOrgSortBy,
  PlatformOrgSortOrder,
  PlatformOrgsPagination,
  PlatformPlanName,
  SetPlatformOrgPlanRequest,
  SuspendPlatformOrgRequest,
  UpdatePlatformOrgRequest
} from '../utils/types';
import { BaseApiWithErrors, classroomio } from '$lib/utils/services/api';
import { ZPlatformCreateOrg, type TPlatformCreateOrg } from '@cio/utils/validation/platform';

import { mapZodErrorsToTranslations } from '$lib/utils/validation';
import { snackbar } from '$features/ui/snackbar/store';

interface ListParams {
  page?: number;
  search?: string;
  sortBy?: PlatformOrgSortBy;
  sortOrder?: PlatformOrgSortOrder;
}

class PlatformApi extends BaseApiWithErrors {
  organizations = $state<PlatformOrgList>([]);
  pagination = $state<PlatformOrgsPagination | null>(null);
  detail = $state<PlatformOrgDetail | null>(null);

  /** Deployment-wide chat model, and the models the server will accept. */
  chatModel = $state<string | null>(null);
  selectableChatModels = $state<Array<{ id: string; multiplier: number; isMeasuredCost: boolean; isLive: boolean }>>(
    []
  );

  async loadSettings() {
    return this.execute({
      requestFn: () => classroomio.platform.settings.$get(),
      logContext: 'loading platform settings',
      onSuccess: (response) => {
        this.chatModel = response.data.chatModel;
        // The list comes from the server so it cannot drift from the cost
        // multipliers it has to agree with.
        this.selectableChatModels = [...response.data.selectableChatModels];
      }
    });
  }

  async setChatModel(chatModel: string | null) {
    return this.execute({
      requestFn: () => classroomio.platform.settings.$put({ json: { chatModel } }),
      logContext: 'updating platform chat model',
      onSuccess: (response) => {
        this.chatModel = response.data.chatModel;
        snackbar.success('platform.snackbar.settings_updated');
      }
    });
  }

  async listOrganizations(params: ListParams = {}) {
    const query = {
      page: String(params.page ?? 1),
      limit: '20',
      sortBy: params.sortBy ?? 'createdAt',
      sortOrder: params.sortOrder ?? 'desc',
      ...(params.search ? { search: params.search } : {})
    };

    return this.execute<ListPlatformOrgsRequest>({
      requestFn: () => classroomio.platform.organizations.$get({ query }),
      logContext: 'listing platform organizations',
      onSuccess: (response) => {
        this.organizations = response.data;
        this.pagination = response.pagination;
      }
    });
  }

  async loadOrganization(orgId: string) {
    return this.execute<GetPlatformOrgRequest>({
      requestFn: () => classroomio.platform.organizations[':orgId'].$get({ param: { orgId } }),
      logContext: 'loading platform organization',
      onSuccess: (response) => {
        this.detail = response.data;
      }
    });
  }

  async domainAction(orgId: string, action: PlatformDomainAction, domain?: string) {
    return this.execute<PlatformDomainRequest>({
      requestFn: () =>
        classroomio.platform.organizations[':orgId'].domain.$post({
          param: { orgId },
          json: { action, ...(domain ? { domain } : {}) }
        }),
      logContext: `${action} custom domain`,
      onSuccess: async () => {
        const messageByAction: Record<PlatformDomainAction, string> = {
          connect: 'platform.snackbar.domain_connected',
          refresh: 'platform.snackbar.domain_refreshed',
          remove: 'platform.snackbar.domain_removed'
        };
        snackbar.success(messageByAction[action]);
        await this.loadOrganization(orgId);
      },
      onError: (result) => {
        if (typeof result === 'object' && 'error' in result) {
          snackbar.error(result.error);
        }
      }
    });
  }

  async createOrganization(fields: TPlatformCreateOrg) {
    const parsed = ZPlatformCreateOrg.safeParse(fields);
    if (!parsed.success) {
      this.errors = mapZodErrorsToTranslations(parsed.error);
      return;
    }

    return this.execute<CreatePlatformOrgRequest>({
      requestFn: () => classroomio.platform.organizations.$post({ json: parsed.data }),
      logContext: 'creating platform organization',
      onSuccess: async () => {
        snackbar.success('platform.snackbar.org_created');
        await this.listOrganizations();
      },
      onError: (result) => {
        if (typeof result === 'object' && 'field' in result && result.field) {
          this.errors[result.field] = result.error;
        } else if (typeof result === 'object' && 'error' in result) {
          snackbar.error(result.error);
        }
      }
    });
  }

  async renameOrganization(orgId: string, name: string, siteName?: string) {
    return this.execute<UpdatePlatformOrgRequest>({
      requestFn: () =>
        classroomio.platform.organizations[':orgId'].$put({
          param: { orgId },
          // Solo va si cambio: mandarlo siempre haria que cada renombrado
          // reescriba el subdominio, y ahi cualquier normalizacion silenciosa se
          // volveria un cambio de direccion que nadie pidio.
          json: { name, ...(siteName ? { siteName } : {}) }
        }),
      logContext: 'renaming platform organization',
      onSuccess: (response) => {
        this.applyOrgUpdate(response.data);
        snackbar.success('platform.snackbar.org_updated');
      }
    });
  }

  async setSuspension(orgId: string, suspend: boolean) {
    return this.execute<SuspendPlatformOrgRequest>({
      requestFn: () =>
        classroomio.platform.organizations[':orgId'].suspend.$post({ param: { orgId }, json: { suspend } }),
      logContext: 'updating organization suspension',
      onSuccess: (response) => {
        this.applyOrgUpdate(response.data);
        snackbar.success(suspend ? 'platform.snackbar.org_suspended' : 'platform.snackbar.org_reactivated');
      }
    });
  }

  /**
   * `aiTokenAllowance` is optional on purpose and its three states reach the
   * server unchanged: omitted keeps the current cap, null clears the override
   * back to the plan's default, a number sets it.
   */
  async setPlan(orgId: string, planName: PlatformPlanName, aiTokenAllowance?: number | null, aiModel?: string | null) {
    return this.execute<SetPlatformOrgPlanRequest>({
      requestFn: () =>
        classroomio.platform.organizations[':orgId'].plan.$put({
          param: { orgId },
          json: {
            planName,
            ...(aiTokenAllowance === undefined ? {} : { aiTokenAllowance }),
            ...(aiModel === undefined ? {} : { aiModel })
          }
        }),
      logContext: 'updating organization plan',
      onSuccess: async () => {
        snackbar.success('platform.snackbar.plan_updated');
        // Refresh the detail (plan/allowance) and the list (plan column).
        await Promise.all([this.loadOrganization(orgId), this.listOrganizations()]);
      }
    });
  }

  /** Reflect an updated org row into the in-memory list without a refetch. */
  private applyOrgUpdate(updated: { id: string; isRestricted?: boolean; name?: string } | null) {
    if (!updated) return;

    this.organizations = this.organizations.map((org) =>
      org.id === updated.id
        ? { ...org, name: updated.name ?? org.name, isRestricted: updated.isRestricted ?? org.isRestricted }
        : org
    );
  }
}

export const platformApi = new PlatformApi();
