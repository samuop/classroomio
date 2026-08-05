import { BaseApiWithErrors, classroomio } from '$lib/utils/services/api';

import type { ClientsOverview, ClientsOverviewRequest } from '../utils/types';

class ClientsApi extends BaseApiWithErrors {
  overview = $state<ClientsOverview | null>(null);

  async loadOverview() {
    return this.execute<ClientsOverviewRequest>({
      requestFn: () => classroomio.organization.clients.overview.$get(),
      logContext: 'loading client companies overview',
      onSuccess: (response) => {
        this.overview = response.data;
      }
    });
  }
}

export const clientsApi = new ClientsApi();
