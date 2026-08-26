import type { TProfile, TUser } from '@cio/db/types';

import { derived, writable } from 'svelte/store';
import { isPlatformAdminRole } from '@cio/utils/constants';

interface UserStore {
  openAuthModal: boolean;
  fetchingUser: boolean;
  isLoggedIn: boolean;
  currentSession: TUser | undefined;
  expiresAt: number;
}

// Using TProfile type from @cio/utils/types with optional id for store initialization
export type ProfileStore = Omit<TProfile, 'id'> & {
  id: string | undefined;
};

export const defaultUserState: UserStore = {
  openAuthModal: false,
  fetchingUser: true,
  isLoggedIn: false,
  currentSession: undefined,
  expiresAt: 0
};

export const defaultProfileState: TProfile = {
  id: '',
  fullname: '',
  avatarUrl: '',
  username: '',
  email: null,
  role: null,
  goal: null,
  source: null,
  telegramChatId: null,
  locale: 'es',
  isEmailVerified: false,
  verifiedAt: null,
  canAddCourse: true,
  isRestricted: false,
  createdAt: '',
  updatedAt: '',
  metadata: null
};

export const user = writable<UserStore>(defaultUserState);

export const profile = writable<TProfile>(defaultProfileState);

/**
 * Quién opera la plataforma, y no una empresa dentro de ella.
 *
 * Es lo que decide **si se ven los números de consumo de IA o sólo porcentajes**:
 * cualquier admin de empresa —la consultora incluida— ve "41% de tu cupo", y
 * únicamente el super-admin ve las fichas reales. Ver `utils/ai-usage.ts`.
 *
 * Vive acá, derivado del store, y no como un `$derived` copiado en cada
 * componente: la comprobación ya estaba escrita a mano en dos lugares, y una
 * regla de visibilidad repetida es una regla que en algún momento se aplica en
 * un lugar y en otro no.
 *
 * Arranca en `false` mientras la sesión se está cargando, que es lo correcto:
 * ante la duda, mostrar de menos.
 */
export const isPlatformAdmin = derived(user, ($user) => isPlatformAdminRole($user.currentSession?.role));
