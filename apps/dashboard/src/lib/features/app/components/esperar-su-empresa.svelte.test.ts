import { get } from 'svelte/store';
import { createRawSnippet, flushSync } from 'svelte';
import { render, screen } from '@testing-library/svelte';

import EsperarSuEmpresa from './esperar-su-empresa.svelte';
import { ROLE } from '@cio/utils/constants';
import { appInitApi } from '$features/app/init.svelte';
import { currentOrg } from '$lib/utils/store/org';

// init.svelte.ts arrastra Sentry, que importa `$app/stores` de SvelteKit: acá
// no existe y no hace falta, porque lo que se prueba es la espera, no el aviso.
vi.mock('$lib/utils/services/sentry', () => ({ setSentryUser: vi.fn() }));

/**
 * Entrar en frío por el dominio de una consultora.
 *
 * El orden real: el layout raíz pone a la dueña del dominio (sin rol), y recién
 * cuando llega la cuenta se pone la empresa de la persona. Una pantalla que se
 * monta antes pide sus datos con la dueña: eso es lo que mandaba a la alumna al
 * panel de la consultora.
 */

const EMPRESA_VACIA = get(currentOrg);
const DUENA_DEL_DOMINIO = { ...EMPRESA_VACIA, id: 'consultora', siteName: 'consultora', roleId: undefined as never };
const SU_EMPRESA = { ...EMPRESA_VACIA, id: 'empresa-cliente', siteName: 'empresa-cliente', roleId: ROLE.STUDENT };

let montadaCon: string[] = [];

const pantalla = createRawSnippet(() => ({
  render: () => '<p>pantalla</p>',
  setup: () => {
    montadaCon.push(get(currentOrg).id);
  }
}));

beforeEach(() => {
  montadaCon = [];
  appInitApi.data = null;
  appInitApi.error = null;
});

afterEach(() => {
  currentOrg.set(EMPRESA_VACIA);
  appInitApi.data = null;
  appInitApi.error = null;
});

describe('EsperarSuEmpresa', () => {
  it('en el dominio de una empresa, la pantalla se monta recién con la empresa de la persona', async () => {
    currentOrg.set(DUENA_DEL_DOMINIO);
    render(EsperarSuEmpresa, { props: { isOrgSite: true, conSesion: true, children: pantalla } });

    expect(screen.queryByText('pantalla')).not.toBeInTheDocument();

    // Lo que hace setupApp al recibir la cuenta: guarda los datos y pone la empresa.
    appInitApi.data = { success: true } as never;
    currentOrg.set(SU_EMPRESA);
    flushSync();

    expect(screen.getByText('pantalla')).toBeInTheDocument();
    expect(montadaCon).toEqual(['empresa-cliente']);
  });

  it('si la cuenta falla, no deja la pantalla colgada en la espera', async () => {
    currentOrg.set(DUENA_DEL_DOMINIO);
    render(EsperarSuEmpresa, { props: { isOrgSite: true, conSesion: true, children: pantalla } });

    appInitApi.error = 'fallo';
    flushSync();

    expect(screen.getByText('pantalla')).toBeInTheDocument();
  });

  it('sin sesión, o fuera del dominio de una empresa, no espera a nadie', async () => {
    const { unmount } = render(EsperarSuEmpresa, { props: { isOrgSite: true, conSesion: false, children: pantalla } });
    expect(screen.getByText('pantalla')).toBeInTheDocument();
    unmount();

    render(EsperarSuEmpresa, { props: { isOrgSite: false, conSesion: true, children: pantalla } });
    expect(screen.getByText('pantalla')).toBeInTheDocument();
  });
});
