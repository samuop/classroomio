import type {
  AccountUsage,
  AccountWorkspaceLimits,
  AccountWorkspaceList,
  CreateAccountWorkspaceRequest,
  DeleteAccountWorkspaceRequest,
  GetAccountUsageRequest,
  ListAccountWorkspacesRequest
} from '../utils/types';
import { BaseApiWithErrors, classroomio } from '$lib/utils/services/api';
import { ZCreateWorkspace, type TCreateWorkspace } from '@cio/utils/validation/account';

import { mapZodErrorsToTranslations } from '$lib/utils/validation';
import { snackbar } from '$features/ui/snackbar/store';

class AccountApi extends BaseApiWithErrors {
  workspaces = $state<AccountWorkspaceList>([]);
  limits = $state<AccountWorkspaceLimits | null>(null);
  usage = $state<AccountUsage | null>(null);

  async listWorkspaces() {
    return this.execute<ListAccountWorkspacesRequest>({
      requestFn: () => classroomio.account.workspaces.$get(),
      logContext: 'fetching account workspaces',
      onSuccess: (response) => {
        this.workspaces = response.data.workspaces;
        this.limits = response.data.limits;
      }
    });
  }

  async loadUsage() {
    return this.execute<GetAccountUsageRequest>({
      requestFn: () => classroomio.account.usage.$get(),
      logContext: 'fetching account usage',
      onSuccess: (response) => {
        this.usage = response.data;
      }
    });
  }

  async createWorkspace(fields: TCreateWorkspace) {
    /**
     * Empezar en limpio, y esto NO es higiene: es el arreglo.
     *
     * `success` es del pedido anterior, y la pantalla lista los espacios de
     * trabajo apenas se abre, así que llega en `true`. Cuando la validación
     * fallaba volvíamos acá abajo sin tocarlo, quien llama leía ese éxito viejo
     * y cerraba el diálogo — con el mensaje de error adentro. El resultado para
     * la persona era que el botón no hacía nada: ni empresa creada, ni una
     * palabra sobre por qué.
     *
     * Un `return` temprano que deja el estado del intento anterior es la forma
     * de este bug; limpiarlo ANTES de poder salir es lo que impide repetirlo.
     */
    this.reset();

    const parsed = ZCreateWorkspace.safeParse(fields);
    if (!parsed.success) {
      // `workspace` como entidad para que los mensajes puedan hablar de estos
      // campos y no del genérico "El valor es demasiado pequeño".
      this.errors = mapZodErrorsToTranslations(parsed.error, 'workspace');
      return;
    }

    return this.execute<CreateAccountWorkspaceRequest>({
      requestFn: () => classroomio.account.workspaces.$post({ json: parsed.data }),
      logContext: 'creating workspace',
      onSuccess: async (response) => {
        this.workspaces = [...this.workspaces, response.data];
        snackbar.success('snackbar.account.workspaceCreated');
        await this.listWorkspaces();
      },
      onError: (result) => {
        if (typeof result === 'object' && 'code' in result) {
          snackbar.error(`snackbar.account.${String(result.code).toLowerCase()}`);
        }
      }
    });
  }

  async deleteWorkspace(workspaceId: string) {
    return this.execute<DeleteAccountWorkspaceRequest>({
      requestFn: () => classroomio.account.workspaces[':workspaceId'].$delete({ param: { workspaceId } }),
      logContext: 'deleting workspace',
      onSuccess: () => {
        this.workspaces = this.workspaces.filter((row) => row.id !== workspaceId);
        snackbar.success('snackbar.account.workspaceDeleted');
      },
      onError: (result) => {
        if (typeof result === 'object' && 'code' in result) {
          snackbar.error(`snackbar.account.${String(result.code).toLowerCase()}`);
        }
      }
    });
  }
}

export const accountApi = new AccountApi();
