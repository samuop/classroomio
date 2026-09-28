import { get } from 'svelte/store';

import { ROLE } from '@cio/utils/constants';
import { basePath, globalStore, isOrgStudent } from './app';
import { currentOrg, isOrgAdmin } from './org';

/**
 * La dueña del dominio llega del servidor sin `roleId`. Leída como «no es
 * alumna», el camino base era el panel de administración de la consultora, y
 * ahí terminaba la alumna de una empresa cliente cuando algo fallaba.
 */

const EMPRESA_VACIA = get(currentOrg);
const GLOBAL_VACIO = get(globalStore);

afterEach(() => {
  currentOrg.set(EMPRESA_VACIA);
  globalStore.set(GLOBAL_VACIO);
});

describe('rol todavía desconocido', () => {
  it('la dueña del dominio sin rol no es ni alumna ni administradora: no se sabe', () => {
    globalStore.set({ ...GLOBAL_VACIO, isOrgSite: true });
    currentOrg.set({ ...EMPRESA_VACIA, id: 'consultora', siteName: 'consultora', roleId: undefined as never });

    expect(get(isOrgStudent)).toBeNull();
    expect(get(isOrgAdmin)).toBeNull();
    expect(get(basePath)).toBe('/lms');
  });

  it('con el rol ya conocido, decide el rol', () => {
    globalStore.set({ ...GLOBAL_VACIO, isOrgSite: true });
    currentOrg.set({ ...EMPRESA_VACIA, id: 'cliente', siteName: 'cliente', roleId: ROLE.ADMIN });

    expect(get(isOrgStudent)).toBe(false);
    expect(get(isOrgAdmin)).toBe(true);
    expect(get(basePath)).toBe('/org/cliente');
  });
});
